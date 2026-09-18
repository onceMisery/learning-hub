import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // 关键：Electron 用 file:// 加载产物，必须用相对路径
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    strictPort: true,
  },

  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Vitest 5 默认用 forks 池；在部分沙箱/受限环境里 worker 起不来，
    // 改 threads 更稳。若你的环境正常，去掉这一行也可以。
    pool: 'threads',
  },
});
