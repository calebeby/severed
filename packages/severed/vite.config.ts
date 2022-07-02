import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import * as path from 'path';

const cwd = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    includeSource: ['**.ts'],
    coverage: {
      reporter: ['text', 'cobertura', 'html-spa', 'lcovonly'],
    },
  },
  resolve: {
    alias: [{ find: 'severed', replacement: path.join(cwd, 'index.ts') }],
  },
});
