import { defineConfig } from 'vitest/config';
import { inlineWasmBytes } from './viteWasmPlugin';

export default defineConfig({
  plugins: [inlineWasmBytes()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
