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

  async uploadImage({ bytes, filename, subfolder = '', overwrite = true }) {
    const form = new FormData();
    form.append('image', new Blob([bytes]), filename);
    if (subfolder) form.append('subfolder', subfolder);
    form.append('overwrite', overwrite ? 'true' : 'false');
    const res = await fetchWithTimeout(this.url('/upload/image'), {
      timeoutMs: 30_000,
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ComfyUI /upload/image HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    if (!data?.name) {
      throw new Error(`ComfyUI /upload/image response missing name: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { name: data.name, subfolder: data.subfolder ?? '', type: data.type ?? 'input' };
  }

  async getHistory(promptId) {
    const res = await fetchWithTimeout(this.url(`/history/${promptId}`), { timeoutMs: 10_000 });
    if (!res.ok) throw new Error(`ComfyUI /history HTTP ${res.status}`);
    const data = await res.json();
    return data?.[promptId] ?? null;
  }

  async waitForCompletion(promptId, { pollIntervalMs = 1500, maxWaitMs = 10 * 60_000, maxPollErrors = 8, onPoll } = {}) {
    const startedAt = Date.now();
    let attempts = 0;
    let consecutiveErrors = 0;
    while (true) {
      attempts += 1;
      // A single slow/aborted /history poll (common when ComfyUI is under VRAM
      // pressure and momentarily unresponsive) must not kill an in-flight run.
      // Tolerate transient poll errors and only give up after maxPollErrors in a
      // row — the actual generation keeps running on the ComfyUI side meanwhile.
      let entry;
      try {
        entry = await this.getHistory(promptId);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors += 1;
        onPoll?.({ attempts, elapsedMs: Date.now() - startedAt, entry: null, error: err, consecutiveErrors });
        if (consecutiveErrors >= maxPollErrors) {
          throw new Error(`ComfyUI run ${promptId}: ${consecutiveErrors} consecutive poll failures (last: ${err.message})`);
        }
        if (Date.now() - startedAt > maxWaitMs) {
          throw new Error(`ComfyUI run ${promptId} timed out after ${maxWaitMs} ms`);
        }
        await delay(pollIntervalMs);
        continue;
      }
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

  // Whether ComfyUI currently exposes a given node class. Used to gate IP-Adapter
  // before the custom nodes have been loaded (they require a ComfyUI restart after
  // install). Cached per class since /object_info is stable within a run.
  async hasNode(classType) {
    this._nodeCache ??= new Set();
    // Only positive results are cached: a node absent now may appear after the
    // user restarts ComfyUI with the custom nodes loaded, without a backend restart.
    if (this._nodeCache.has(classType)) return true;
    let present = false;
    try {
      const res = await fetchWithTimeout(this.url(`/object_info/${classType}`), { timeoutMs: 10_000 });
      if (res.ok) {
        const data = await res.json();
        present = data && typeof data === 'object' && Object.keys(data).length > 0;
      }
    } catch {
      present = false;
    }
    if (present) this._nodeCache.add(classType);
    return present;
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
