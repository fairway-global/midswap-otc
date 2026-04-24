import 'vite/client';

declare global {
  /** Build-time ISO timestamp — injected by vite.config.ts `define`. */
  const __BUILD_TIME__: string;
}
