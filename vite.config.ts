import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  // relative base so the same build works on GitHub Pages project sites and local preview
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  assetsInclude: ['**/*.wasm'],
});
