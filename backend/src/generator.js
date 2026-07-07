import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkflowTemplate, applyParams } from './comfyui/workflow.js';

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
    filenamePrefix,
  };

  const wf = applyParams(template, refs, params);
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
        width: finalLatent.width,
        height: finalLatent.height,
        batchSize: finalLatent.batch_size,
      },
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
  return { promptId, clientId, durationMs, images: saved, seed: resolvedSeed };
}

export class Generator {
  constructor(client) {
    this.client = client;
    this.generate = generate.bind(this);
  }
}
