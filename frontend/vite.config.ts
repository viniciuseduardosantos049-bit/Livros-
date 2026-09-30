import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A porta do backend é descoberta em tempo de execução (ver backend/src/lib/port.ts).
// Em dev, aponte VITE_API_TARGET para a porta impressa pelo servidor, se for diferente.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4300';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
