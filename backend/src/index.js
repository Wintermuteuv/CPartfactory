import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { ComfyClient } from './comfyui/client.js';
import { Generator } from './generator.js';
import { loadAxesConfig } from './axes/loader.js';
import { validateCombination } from './axes/validator.js';
import { buildPrompt } from './axes/promptBuilder.js';
import { optimize } from './axes/promptOptimizer.js';
import { derive } from './axes/depth.js';
import { loadCoverage, addItem, updateItem, deleteItem } from './coverage/store.js';
import { computeCoverage } from './coverage/scanner.js';
import { ComfyWSClient } from './comfyui/wsclient.js';
import { ProgressTracker } from './progress.js';

import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(__dirname, '..', '..', 'frontend');
const outputDir = resolve(__dirname, '..', '..', 'output');
await mkdir(outputDir, { recursive: true });

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

const wsClient = new ComfyWSClient({ logger: app.log });
const comfy = new ComfyClient({ clientId: wsClient.clientId });
const generator = new Generator(comfy);
const progress = new ProgressTracker();
progress.attach(wsClient);
wsClient.start();
const axesConfig = await loadAxesConfig();
app.decorate('comfy', comfy);
app.decorate('generator', generator);
app.decorate('progress', progress);
app.decorate('axesConfig', axesConfig);

app.get('/progress/active', async () => progress.active() ?? { status: 'idle' });
app.get('/progress/:promptId', async (req, reply) => {
  const p = progress.get(req.params.promptId);
  if (!p) return reply.code(404).send({ error: 'unknown promptId' });
  return p;
});

app.get('/axes', async () => axesConfig.raw);

app.post('/axes/derive', async (req, reply) => {
  const depth = Number(req.body?.depth);
  if (!Number.isInteger(depth) || depth < -60 || depth > -1) {
    return reply.code(400).send({ error: 'depth must be integer in [-60, -1]' });
  }
  return { depth, ...derive(depth, axesConfig.rules) };
});

app.post('/axes/validate', async (req) => {
  return validateCombination(req.body ?? {}, axesConfig);
});

app.get('/axes/random', async () => {
  const A = axesConfig.raw.axes;
  const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)].id;
  const pick = () => ({
    material:  randomOf(A.material.values),
    spaceType: randomOf(A.spaceType.values),
    origin:    randomOf(A.origin.values),
    occupant:  randomOf(A.occupant.values),
    lighting:  randomOf(A.lighting.values),
    camera:    randomOf(A.camera.values),
    condition: randomOf(A.condition.values),
    occupancy: randomOf(A.occupancy.values),
    depth:     -(1 + Math.floor(Math.random() * 60)),
  });
  // Retry until the combination is lore-valid (rules are depth-dependent, so
  // most random picks are rejected). Best-effort after the cap.
  let selection = pick();
  let validation = validateCombination(selection, axesConfig);
  for (let i = 0; i < 120 && !validation.ok; i += 1) {
    selection = pick();
    validation = validateCombination(selection, axesConfig);
  }
  return { selection, valid: validation.ok };
});

app.post('/prompt/preview', async (req) => {
  const selection = req.body ?? {};
  const validation = validateCombination(selection, axesConfig);
  // Build the prompt even for invalid combinations: the builder tolerates missing
  // axes / out-of-range depth, and the UI needs a preview that matches what a
  // force-generate would actually send. Validity is signalled separately.
  let prompt = null;
  try {
    prompt = optimize(buildPrompt(selection, axesConfig), selection, axesConfig);
  } catch (err) {
    req.log?.warn({ err }, 'preview build failed');
  }
  return { validation, prompt };
});

app.get('/coverage', async () => {
  const cov = await loadCoverage();
  return await computeCoverage(cov.items, outputDir);
});

app.post('/coverage', async (req, reply) => {
  try {
    const item = await addItem(req.body ?? {});
    return reply.code(201).send(item);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

app.put('/coverage/:id', async (req, reply) => {
  try {
    const item = await updateItem(req.params.id, req.body ?? {});
    return item;
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
});

app.delete('/coverage/:id', async (req, reply) => {
  const ok = await deleteItem(req.params.id);
  if (!ok) return reply.code(404).send({ error: 'not found' });
  return { deleted: true };
});

app.post('/generate', async (req, reply) => {
  const body = req.body ?? {};
  const force = body.force === true;

  // treat a blank/whitespace manual prompt as unset so axes still drive generation
  let positive = (typeof body.positive === 'string' && body.positive.trim() !== '') ? body.positive : undefined;
  let negative = body.negative;
  let axesPayload = null;
  let derivedPayload = null;
  let optimizerPayload = null;
  let validation = null;

  if (body.axes && typeof body.axes === 'object') {
    validation = validateCombination(body.axes, axesConfig);
    if (!validation.ok && !force) {
      return reply.code(400).send({ error: 'invalid axis combination', validation });
    }
    const built = optimize(buildPrompt(body.axes, axesConfig), body.axes, axesConfig);
    positive = positive ?? built.positive;
    negative = negative ?? built.negative;
    axesPayload = body.axes;
    derivedPayload = built.derived;
    optimizerPayload = built.optimizer ? { ...built.optimizer, notes: built.notes ?? [] } : null;
  }

  if (!positive || typeof positive !== 'string') {
    return reply.code(400).send({ error: 'positive prompt or axes block is required' });
  }

  try {
    const result = await generator.generate({
      positive,
      negative,
      seed: body.seed,
      steps: body.steps,
      cfg: body.cfg,
      sampler: body.sampler,
      scheduler: body.scheduler,
      width: body.width,
      height: body.height,
      batchSize: body.batchSize,
      ckpt: body.ckpt,
      initImage: body.initImage,
      denoise: body.denoise,
      styleImage: body.styleImage,
      styleWeight: body.styleWeight,
      styleWeightType: body.styleWeightType,
      axes: axesPayload,
      derived: derivedPayload,
      optimizer: optimizerPayload,
      stage: body.stage ?? 'draft',
      logger: req.log,
    });
    return { ...result, validation };
  } catch (err) {
    req.log.error({ err }, 'generation failed');
    return reply.code(502).send({ error: err.message ?? String(err) });
  }
});

// Recent generated arts, newest first — feeds the img2img reference picker.
app.get('/outputs', async (req) => {
  const limit = Math.min(Number(req.query?.limit) || 24, 200);
  let names = [];
  try {
    names = (await readdir(outputDir)).filter((n) => n.toLowerCase().endsWith('.png'));
  } catch {
    return { items: [] };
  }
  const withTime = await Promise.all(
    names.map(async (name) => {
      try {
        const s = await stat(join(outputDir, name));
        return { name, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const items = withTime
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((f) => ({
      filename: f.name,
      url: `/images/${encodeURIComponent(f.name)}`,
      createdAt: new Date(f.mtimeMs).toISOString(),
    }));
  return { items };
});

app.get('/healthz', async () => {
  const comfyStatus = await comfy.ping();
  // IP-Adapter is optional (custom nodes); probe only when ComfyUI is reachable.
  const ipAdapter = comfyStatus.ok ? await comfy.hasNode('IPAdapterUnifiedLoader') : false;
  return {
    backend: { ok: true, uptimeSec: Math.round(process.uptime()) },
    comfyui: comfyStatus,
    capabilities: { ipAdapter },
    status: comfyStatus.ok ? 'ready' : 'degraded',
  };
});

await app.register(fastifyStatic, { root: outputDir, prefix: '/images/', decorateReply: false });
await app.register(fastifyStatic, { root: frontendDir, prefix: '/' });

try {
  const address = await app.listen({ port: config.port, host: config.host });
  app.log.info(`art-factory backend listening on ${address}`);
  app.log.info(`ComfyUI target: ${config.comfyUrl}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
