import { defineConfig } from 'vite';
import { inlineWasmBytes } from './viteWasmPlugin';

export default defineConfig({
  root: '.',
  plugins: [inlineWasmBytes()],
  // Relative asset URLs keep the build valid both at the domain root and under
  // a GitHub Pages project path (https://<user>.github.io/<repo>/).
  base: './',
  server: { port: 5173 },
  build: {
    // Babylon ships a large core chunk; the warning is noise for this app.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        // Cache the heavy renderer separately from frequently changed app code.
        manualChunks(id) {
          if (id.includes('node_modules/@babylonjs')) return 'babylon';
        },
      },
    },
  },
});
