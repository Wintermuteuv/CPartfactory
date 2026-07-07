import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export class ComfyWSClient extends EventEmitter {
  constructor({ baseUrl = config.comfyUrl, clientId = randomUUID(), logger, reconnectDelayMs = 2000 } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.clientId = clientId;
    this.logger = logger;
    this.reconnectDelayMs = reconnectDelayMs;
    this.ws = null;
    this.reconnectTimer = null;
    this.shouldRun = false;
  }

  url() {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/ws?clientId=${encodeURIComponent(this.clientId)}`;
  }

  start() {
    this.shouldRun = true;
    this.#connect();
  }

  stop() {
    this.shouldRun = false;
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  #connect() {
    const url = this.url();
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.logger?.warn?.({ err: String(err) }, 'ComfyUI WS construct failed');
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open',  () => this.logger?.info?.({ clientId: this.clientId }, 'ComfyUI WS connected'));
    ws.addEventListener('close', () => { this.ws = null; this.#scheduleReconnect(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg && typeof msg === 'object') this.emit('message', msg);
      } catch {
        // ignore non-JSON frames (binary previews etc.)
      }
    });
  }

  #scheduleReconnect() {
    if (!this.shouldRun) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.#connect(), this.reconnectDelayMs);
  }
}
