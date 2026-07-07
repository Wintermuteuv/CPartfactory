import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

async function fetchWithTimeout(url, { timeoutMs, ...init } = {}) {
  if (timeoutMs == null) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class ComfyClient {
  constructor({ baseUrl = config.comfyUrl, timeoutMs = config.comfyTimeoutMs, clientId } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.clientId = clientId ?? randomUUID();
  }

  url(path) {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  newClientId() {
    return randomUUID();
  }

  async submit(workflow, clientId = this.clientId) {
    const res = await fetchWithTimeout(this.url('/prompt'), {
      timeoutMs: 10_000,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ComfyUI /prompt rejected with HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = await res.json();
    if (!data?.prompt_id) {
      throw new Error(`ComfyUI /prompt response missing prompt_id: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { promptId: data.prompt_id, clientId, number: data.number ?? null };
  }

  async getHistory(promptId) {
    const res = await fetchWithTimeout(this.url(`/history/${promptId}`), { timeoutMs: 10_000 });
    if (!res.ok) throw new Error(`ComfyUI /history HTTP ${res.status}`);
    const data = await res.json();
    return data?.[promptId] ?? null;
  }

  async waitForCompletion(promptId, { pollIntervalMs = 1500, maxWaitMs = 10 * 60_000, onPoll } = {}) {
    const startedAt = Date.now();
    let attempts = 0;
    while (true) {
      attempts += 1;
      const entry = await this.getHistory(promptId);
      onPoll?.({ attempts, elapsedMs: Date.now() - startedAt, entry });
      if (entry?.status?.completed) {
        const failed = entry.status?.status_str && entry.status.status_str !== 'success';
        if (failed) {
          throw new Error(`ComfyUI run ${promptId} failed: ${entry.status.status_str}`);
        }
        return entry;
      }
      if (Date.now() - startedAt > maxWaitMs) {
        throw new Error(`ComfyUI run ${promptId} timed out after ${maxWaitMs} ms`);
      }
      await delay(pollIntervalMs);
    }
  }

  collectOutputImages(historyEntry) {
    const outputs = historyEntry?.outputs ?? {};
    const images = [];
    for (const [nodeId, payload] of Object.entries(outputs)) {
      for (const img of payload?.images ?? []) {
        images.push({
          nodeId,
          filename: img.filename,
          subfolder: img.subfolder ?? '',
          type: img.type ?? 'output',
        });
      }
    }
    return images;
  }

  async downloadImage({ filename, subfolder = '', type = 'output' }) {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetchWithTimeout(this.url(`/view?${params}`), { timeoutMs: 60_000 });
    if (!res.ok) throw new Error(`ComfyUI /view HTTP ${res.status} for ${filename}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async ping() {
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(this.url('/system_stats'), { timeoutMs: this.timeoutMs });
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        return {
          ok: false,
          reason: `HTTP ${res.status}`,
          baseUrl: this.baseUrl,
          latencyMs,
        };
      }
      const stats = await res.json();
      return {
        ok: true,
        baseUrl: this.baseUrl,
        latencyMs,
        version: stats?.system?.comfyui_version ?? null,
        pythonVersion: stats?.system?.python_version?.split(' ')[0] ?? null,
        pytorchVersion: stats?.system?.pytorch_version ?? null,
        devices: (stats?.devices ?? []).map((d) => ({
          name: d.name,
          type: d.type,
          vramTotal: d.vram_total,
          vramFree: d.vram_free,
        })),
      };
    } catch (err) {
      return {
        ok: false,
        reason: err.name === 'AbortError' ? 'timeout' : err.code ?? err.message ?? 'unknown',
        baseUrl: this.baseUrl,
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
