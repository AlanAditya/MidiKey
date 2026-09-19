import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const RELAY = process.env.MEDIKEY_RELAY ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': RELAY } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
