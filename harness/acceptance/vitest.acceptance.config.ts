// Vitest config used only when running the immutable acceptance suite.
//
// It mirrors the project's own vitest.config.ts and adds the "@/*" -> "./src/*"
// alias declared in tsconfig.json. The baseline vitest.config.ts omits it
// because no baseline test imports through the alias — but `next build` honours
// it, so production code legitimately uses "@/...". Without this the acceptance
// run would fail to resolve the agent's imports and report a harness gap as an
// implementation defect.
//
// Injected into the work tree root by run-acceptance.sh, then removed.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
});
