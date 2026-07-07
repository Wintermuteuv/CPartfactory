export class ProgressTracker {
  constructor() {
    this.byPrompt = new Map();
    this.lastPromptId = null;
    this.maxEntries = 32;
  }

  attach(wsClient) {
    wsClient.on('message', (msg) => this.#onMessage(msg));
  }

  #upsert(promptId, patch) {
    const prev = this.byPrompt.get(promptId) ?? { promptId, value: 0, max: null, node: null, status: 'pending', error: null };
    const next = { ...prev, ...patch, promptId, updatedAt: Date.now() };
    this.byPrompt.set(promptId, next);
    this.lastPromptId = promptId;
    if (this.byPrompt.size > this.maxEntries) {
      const oldest = [...this.byPrompt.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (oldest) this.byPrompt.delete(oldest[0]);
    }
    return next;
  }

  #onMessage({ type, data }) {
    if (!data) return;
    const id = data.prompt_id;
    if (!id && type !== 'progress') return;

    switch (type) {
      case 'execution_start':
        this.#upsert(id, { status: 'started', value: 0, max: null, node: null, error: null });
        return;
      case 'executing':
        if (data.node === null || data.node === undefined) {
          this.#upsert(id, { status: 'done' });
        } else {
          this.#upsert(id, { status: 'running', node: data.node });
        }
        return;
      case 'progress':
        if (id) {
          this.#upsert(id, { value: data.value, max: data.max, node: data.node ?? null, status: 'running' });
        } else if (this.lastPromptId) {
          this.#upsert(this.lastPromptId, { value: data.value, max: data.max, node: data.node ?? null, status: 'running' });
        }
        return;
      case 'execution_error':
        this.#upsert(id, { status: 'error', error: data.exception_message ?? data.exception_type ?? 'execution error' });
        return;
      case 'execution_cached':
        return;
      default:
        return;
    }
  }

  get(promptId) { return this.byPrompt.get(promptId) ?? null; }

  active() {
    if (!this.lastPromptId) return null;
    const p = this.byPrompt.get(this.lastPromptId);
    if (!p) return null;
    const active = p.status === 'started' || p.status === 'running';
    return active ? p : null;
  }
}
