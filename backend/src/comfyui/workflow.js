import { readFile } from 'node:fs/promises';

function findNodesByType(workflow, classType) {
  return Object.entries(workflow)
    .filter(([, node]) => node?.class_type === classType)
    .map(([id, node]) => ({ id, node }));
}

function single(nodes, classType) {
  if (nodes.length === 0) throw new Error(`workflow: no ${classType} node found`);
  if (nodes.length > 1) {
    throw new Error(`workflow: expected exactly one ${classType}, found ${nodes.length}`);
  }
  return nodes[0];
}

function linkSource(input) {
  return Array.isArray(input) ? String(input[0]) : null;
}

export function resolveWorkflowNodes(workflow) {
  const sampler = single(findNodesByType(workflow, 'KSampler'), 'KSampler');
  const checkpoint = single(findNodesByType(workflow, 'CheckpointLoaderSimple'), 'CheckpointLoaderSimple');
  const latent = single(findNodesByType(workflow, 'EmptyLatentImage'), 'EmptyLatentImage');
  const saver = single(findNodesByType(workflow, 'SaveImage'), 'SaveImage');

  const positiveId = linkSource(sampler.node.inputs?.positive);
  const negativeId = linkSource(sampler.node.inputs?.negative);
  if (!positiveId || !negativeId) {
    throw new Error('workflow: KSampler missing positive/negative links');
  }

  const isClipTextEncode = (id) => workflow[id]?.class_type === 'CLIPTextEncode';
  if (!isClipTextEncode(positiveId) || !isClipTextEncode(negativeId)) {
    throw new Error('workflow: KSampler positive/negative do not point at CLIPTextEncode nodes');
  }

  return {
    sampler: sampler.id,
    checkpoint: checkpoint.id,
    latent: latent.id,
    saver: saver.id,
    positivePrompt: positiveId,
    negativePrompt: negativeId,
  };
}

export async function loadWorkflowTemplate(path) {
  const raw = await readFile(path, 'utf8');
  const workflow = JSON.parse(raw);
  const refs = resolveWorkflowNodes(workflow);
  return { workflow, refs };
}

export function applyParams(template, refs, params) {
  const wf = structuredClone(template);

  if (params.positive != null) wf[refs.positivePrompt].inputs.text = params.positive;
  if (params.negative != null) wf[refs.negativePrompt].inputs.text = params.negative;

  const sampler = wf[refs.sampler].inputs;
  if (params.seed != null) sampler.seed = params.seed;
  if (params.steps != null) sampler.steps = params.steps;
  if (params.cfg != null) sampler.cfg = params.cfg;
  if (params.sampler != null) sampler.sampler_name = params.sampler;
  if (params.scheduler != null) sampler.scheduler = params.scheduler;
  if (params.denoise != null) sampler.denoise = params.denoise;

  if (params.ckpt != null) wf[refs.checkpoint].inputs.ckpt_name = params.ckpt;

  const latent = wf[refs.latent].inputs;
  if (params.width != null) latent.width = params.width;
  if (params.height != null) latent.height = params.height;
  if (params.batchSize != null) latent.batch_size = params.batchSize;

  if (params.filenamePrefix != null) {
    wf[refs.saver].inputs.filename_prefix = params.filenamePrefix;
  }

  return wf;
}

// img2img: inject a LoadImage + VAEEncode pair and rewire the sampler to denoise
// from the encoded reference instead of the EmptyLatentImage. The EmptyLatentImage
// node stays in the graph but becomes orphaned (ComfyUI prunes unreachable nodes),
// so width/height on it no longer affect output — the size follows the reference.
// The VAE is taken from the CheckpointLoaderSimple (output slot 2), matching how
// VAEDecode is wired in the base template.
export const INIT_LOAD_ID = 'init_image_load';
export const INIT_ENCODE_ID = 'init_image_encode';

export function applyInitImage(wf, refs, { imageName, subfolder = '' } = {}) {
  if (!imageName || typeof imageName !== 'string') {
    throw new Error('applyInitImage: imageName is required');
  }
  const image = subfolder ? `${subfolder}/${imageName}` : imageName;

  wf[INIT_LOAD_ID] = {
    class_type: 'LoadImage',
    inputs: { image, upload: 'image' },
    _meta: { title: 'Load init image (img2img)' },
  };
  wf[INIT_ENCODE_ID] = {
    class_type: 'VAEEncode',
    inputs: {
      pixels: [INIT_LOAD_ID, 0],
      vae: [refs.checkpoint, 2],
    },
    _meta: { title: 'VAE Encode (img2img)' },
  };
  wf[refs.sampler].inputs.latent_image = [INIT_ENCODE_ID, 0];

  return wf;
}

// IP-Adapter (style consistency): inject a style-reference LoadImage, the
// IPAdapterUnifiedLoader (auto-picks clip_vision + ipadapter models by preset)
// and IPAdapterAdvanced, then rewire the sampler's MODEL input through the
// patched model. This is orthogonal to applyInitImage (which rewires the LATENT),
// so both can be layered on the same graph — img2img composition + IP-Adapter style.
// Requires the ComfyUI_IPAdapter_plus custom nodes + matching models installed.
export const STYLE_LOAD_ID = 'style_image_load';
export const IPADAPTER_LOADER_ID = 'ipadapter_unified_loader';
export const IPADAPTER_APPLY_ID = 'ipadapter_apply';

export function applyStyleReference(
  wf,
  refs,
  { imageName, subfolder = '', preset = 'PLUS (high strength)', weight = 1.0, weightType = 'style transfer' } = {},
) {
  if (!imageName || typeof imageName !== 'string') {
    throw new Error('applyStyleReference: imageName is required');
  }
  const image = subfolder ? `${subfolder}/${imageName}` : imageName;
  // Compose off whatever currently feeds the sampler's MODEL (checkpoint, or a
  // prior patch) rather than hard-wiring the checkpoint, so this stacks cleanly.
  const modelSource = wf[refs.sampler].inputs.model;

  wf[STYLE_LOAD_ID] = {
    class_type: 'LoadImage',
    inputs: { image, upload: 'image' },
    _meta: { title: 'Load style reference (IP-Adapter)' },
  };
  wf[IPADAPTER_LOADER_ID] = {
    class_type: 'IPAdapterUnifiedLoader',
    inputs: { model: modelSource, preset },
    _meta: { title: 'IPAdapter Unified Loader' },
  };
  wf[IPADAPTER_APPLY_ID] = {
    class_type: 'IPAdapterAdvanced',
    inputs: {
      model: [IPADAPTER_LOADER_ID, 0],
      ipadapter: [IPADAPTER_LOADER_ID, 1],
      image: [STYLE_LOAD_ID, 0],
      weight,
      weight_type: weightType,
      combine_embeds: 'concat',
      start_at: 0.0,
      end_at: 1.0,
      embeds_scaling: 'V only',
    },
    _meta: { title: 'IPAdapter Advanced' },
  };
  wf[refs.sampler].inputs.model = [IPADAPTER_APPLY_ID, 0];

  return wf;
}
