/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3002, strictPort: true },
  // Kokoro / Transformers.js ship WASM workers — keep them out of prebundle.
  optimizeDeps: {
    exclude: ['kokoro-js', '@huggingface/transformers'],
  },
  worker: { format: 'es' },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/setupTests.ts' },
})
