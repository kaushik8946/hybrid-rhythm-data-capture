import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background.ts'),
        'content-bridge': resolve(import.meta.dirname, 'src/content-bridge.ts'),
      },
      output: {
        // Each entry becomes a flat JS file — required for MV3 service workers.
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        format: 'es',
      },
    },
  },
});
