const env = process.env;

export const config = {
  port: Number(env.PORT ?? 5174),
  host: env.HOST ?? '127.0.0.1',
  comfyUrl: (env.COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(/\/+$/, ''),
  comfyTimeoutMs: Number(env.COMFYUI_TIMEOUT_MS ?? 3000),
};
