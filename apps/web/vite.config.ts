import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Em desenvolvimento a API roda em outra porta: o proxy deixa tudo na mesma origem (o cookie de login é SameSite=Strict).
const api = process.env.VITE_API_URL ?? 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/v1': { target: api, changeOrigin: false, ws: true }, '/uploads': api } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
