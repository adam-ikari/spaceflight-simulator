import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative asset URLs keep the build valid both at the domain root and under
  // a GitHub Pages project path (https://<user>.github.io/<repo>/).
  base: './',
  server: { port: 5173 },
  build: {
    // Babylon ships a large core chunk; the warning is noise for this app.
    chunkSizeWarningLimit: 8000,
  },
});
