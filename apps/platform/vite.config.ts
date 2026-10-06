import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const api = process.env.VITE_API_URL ?? 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/v1': api } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
