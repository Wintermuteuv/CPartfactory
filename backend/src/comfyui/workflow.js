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
