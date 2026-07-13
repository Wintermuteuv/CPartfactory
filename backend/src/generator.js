import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkflowTemplate, applyParams, applyInitImage, applyStyleReference } from './comfyui/workflow.js';

// img2img denoise when the caller supplies a reference but no explicit strength.
// 0.5 keeps the reference's composition and palette while letting the prompt
// meaningfully repaint materials/detail — a sane midpoint for consistency work.
const DEFAULT_IMG2IMG_DENOISE = 0.5;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

export const DEFAULT_TEMPLATE_PATH = resolve(repoRoot, 'CursedPit Workflow.json');
export const DEFAULT_OUTPUT_DIR = resolve(repoRoot, 'output');

export const DEFAULT_NEGATIVE =
  'bright, colorful, cartoon, anime, low quality, blurry, watermark, text, signature, oversaturated, cheerful, sunny, modern';

let cachedTemplate = null;
let cachedTemplatePath = null;

async function getTemplate(path) {
  if (cachedTemplate && cachedTemplatePath === path) return cachedTemplate;
  cachedTemplate = await loadWorkflowTemplate(path);
  cachedTemplatePath = path;
  return cachedTemplate;
}

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function timestampSlug(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export async function generate({
  positive,
  negative = DEFAULT_NEGATIVE,
  seed,
  steps,
  cfg,
  sampler,
  scheduler,
  width,
  height,
  batchSize = 1,
  ckpt,
  initImage = null,
  denoise,
  styleImage = null,
  styleWeight = 1.0,
  styleWeightType = 'style transfer',
  stylePreset = 'PLUS (high strength)',
  templatePath = DEFAULT_TEMPLATE_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
  axes = null,
  derived = null,
  optimizer = null,
  stage = 'draft',
  logger,
} = {}) {
  if (!positive || typeof positive !== 'string') {
    throw new Error('generate(): positive prompt is required');
  }

  const { workflow: template, refs } = await getTemplate(templatePath);
  const resolvedSeed = seed ?? randomSeed();
  const slug = timestampSlug();
  const filenamePrefix = `art-factory/${slug}_seed${resolvedSeed}`;

  // img2img: read the reference from output/, upload it into ComfyUI's input dir.
  // Only a bare filename inside outputDir is allowed — guard against traversal.
  const isImg2Img = initImage != null && initImage !== '';
  const resolvedDenoise = isImg2Img ? (denoise ?? DEFAULT_IMG2IMG_DENOISE) : denoise;
  let uploadedRef = null;
  if (isImg2Img) {
    const safeName = basename(String(initImage));
    const refPath = join(outputDir, safeName);
    let bytes;
    try {
      bytes = await readFile(refPath);
    } catch {
      throw new Error(`generate(): init image not found in output: ${safeName}`);
    }
    uploadedRef = await this.client.uploadImage({ bytes, filename: `art-factory-ref-${safeName}` });
    logger?.info({ initImage: safeName, denoise: resolvedDenoise }, 'img2img: reference uploaded');
  }

  // IP-Adapter style reference (orthogonal to img2img: patches MODEL, not LATENT).
  const isStyle = styleImage != null && styleImage !== '';
  let uploadedStyle = null;
  let styleName = null;
  if (isStyle) {
    if (!(await this.client.hasNode('IPAdapterUnifiedLoader'))) {
      throw new Error(
        'IP-Adapter not available: ComfyUI_IPAdapter_plus nodes are not loaded. ' +
          'Install the custom nodes + models, then restart ComfyUI.',
      );
    }
    styleName = basename(String(styleImage));
    const stylePath = join(outputDir, styleName);
    let styleBytes;
    try {
      styleBytes = await readFile(stylePath);
    } catch {
      throw new Error(`generate(): style image not found in output: ${styleName}`);
    }
    uploadedStyle = await this.client.uploadImage({ bytes: styleBytes, filename: `art-factory-style-${styleName}` });
    logger?.info({ styleImage: styleName, styleWeight, styleWeightType }, 'ip-adapter: style reference uploaded');
  }

  const params = {
    positive,
    negative,
    seed: resolvedSeed,
    steps,
    cfg,
    sampler,
    scheduler,
    width,
    height,
    batchSize,
    ckpt,
    denoise: resolvedDenoise,
    filenamePrefix,
  };

  let wf = applyParams(template, refs, params);
  if (isImg2Img) {
    wf = applyInitImage(wf, refs, { imageName: uploadedRef.name, subfolder: uploadedRef.subfolder });
  }
  if (isStyle) {
    wf = applyStyleReference(wf, refs, {
      imageName: uploadedStyle.name,
      subfolder: uploadedStyle.subfolder,
      preset: stylePreset,
      weight: styleWeight,
      weightType: styleWeightType,
    });
  }
  const finalSampler = wf[refs.sampler].inputs;
  const finalLatent = wf[refs.latent].inputs;
  const finalCkpt = wf[refs.checkpoint].inputs.ckpt_name;

  await mkdir(outputDir, { recursive: true });

  const startedAt = Date.now();
  logger?.info({ seed: resolvedSeed, steps: finalSampler.steps, w: finalLatent.width, h: finalLatent.height, batch: finalLatent.batch_size }, 'submitting workflow');
  const { promptId, clientId } = await this.client.submit(wf);
  logger?.info({ promptId }, 'queued, waiting for completion');

  const entry = await this.client.waitForCompletion(promptId, {
    onPoll: ({ attempts, elapsedMs }) => {
      if (attempts % 10 === 0) logger?.info({ promptId, attempts, elapsedMs }, 'still waiting');
    },
  });

  const images = this.client.collectOutputImages(entry);
  const saved = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const bytes = await this.client.downloadImage(img);
    const localName = `${slug}_seed${resolvedSeed}_${String(i).padStart(2, '0')}.png`;
    const localPath = join(outputDir, localName);
    await writeFile(localPath, bytes);

    const meta = {
      prompt_positive: positive,
      prompt_negative: negative,
      seed: resolvedSeed,
      axes,
      derived,
      optimizer,
      params: {
        steps: finalSampler.steps,
        cfg: finalSampler.cfg,
        sampler: finalSampler.sampler_name,
        scheduler: finalSampler.scheduler,
        denoise: finalSampler.denoise,
        width: finalLatent.width,
        height: finalLatent.height,
        batchSize: finalLatent.batch_size,
      },
      img2img: isImg2Img
        ? { initImage: basename(String(initImage)), denoise: finalSampler.denoise }
        : null,
      ipAdapter: isStyle
        ? { styleImage: styleName, weight: styleWeight, weightType: styleWeightType, preset: stylePreset }
        : null,
      checkpoint: finalCkpt,
      styleVersion: 'none',
      stage,
      comfy: { promptId, clientId, sourceNode: img.nodeId, sourceFilename: img.filename, subfolder: img.subfolder, type: img.type },
      createdAt: new Date().toISOString(),
    };
    await writeFile(localPath.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 2));
    saved.push({
      filename: localName,
      path: localPath,
      sidecar: localPath.replace(/\.png$/, '.json'),
      url: `/images/${encodeURIComponent(localName)}`,
    });
  }

  const durationMs = Date.now() - startedAt;
  logger?.info({ promptId, count: saved.length, durationMs }, 'generation complete');
  return {
    promptId,
    clientId,
    durationMs,
    images: saved,
    seed: resolvedSeed,
    img2img: isImg2Img ? { initImage: basename(String(initImage)), denoise: finalSampler.denoise } : null,
    ipAdapter: isStyle ? { styleImage: styleName, weight: styleWeight, weightType: styleWeightType } : null,
  };
}

export class Generator {
  constructor(client) {
    this.client = client;
    this.generate = generate.bind(this);
  }
}
