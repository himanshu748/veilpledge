import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.VITE_BASE_PATH ?? '/',
  cacheDir: '.vite',
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('onchain-runtime-v3')) return 'midnight-wasm';
          if (id.includes('@midnight-ntwrk')) return 'midnight-sdk';
          if (id.includes('react')) return 'react-vendor';
          return undefined;
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    wasm(),
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: (index) => `__tla_${index}`,
    }),
  ],
  optimizeDeps: {
    include: ['@midnight-ntwrk/compact-runtime'],
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
  },
  resolve: {
    alias: {
      assert: fileURLToPath(new URL('./src/polyfills/assert.ts', import.meta.url)),
      events: fileURLToPath(new URL('./src/polyfills/events.ts', import.meta.url)),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
