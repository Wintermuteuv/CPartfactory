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

import { mkdir } from 'node:fs/promises';

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

app.post('/prompt/preview', async (req) => {
  const selection = req.body ?? {};
  const validation = validateCombination(selection, axesConfig);
  const prompt = validation.ok ? optimize(buildPrompt(selection, axesConfig), selection, axesConfig) : null;
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

  let positive = body.positive;
  let negative = body.negative;
  let axesPayload = null;
  let derivedPayload = null;
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
      axes: axesPayload,
      derived: derivedPayload,
      stage: body.stage ?? 'draft',
      logger: req.log,
    });
    return { ...result, validation };
  } catch (err) {
    req.log.error({ err }, 'generation failed');
    return reply.code(502).send({ error: err.message ?? String(err) });
  }
});

app.get('/healthz', async () => {
  const comfyStatus = await comfy.ping();
  return {
    backend: { ok: true, uptimeSec: Math.round(process.uptime()) },
    comfyui: comfyStatus,
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
