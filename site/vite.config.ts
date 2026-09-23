import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 给 GitHub Pages 补一份 SPA 兜底页。
 *
 * Pages 没有回退规则可配，未命中文件的深链会吃到它自己的 404 页；约定是用
 * 404.html 兜底，所以构建末尾把 index.html 原样复制一份。产物里的资源地址已经
 * 带上 base 前缀，深链的路径又正好是 BrowserRouter 要读的，因此这份复制就够。
 * Vercel 走 vercel.json 的 rewrites，多个 404.html 对它无害。
 */
function githubPagesFallback(): Plugin {
  let outDir = '';
  return {
    name: 'github-pages-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        const index = resolve(outDir, 'index.html');
        if (existsSync(index)) writeFileSync(resolve(outDir, '404.html'), readFileSync(index));
      },
    },
  };
}

/**
 * 站点构建配置。
 *
 * base 通过环境变量 SITE_BASE 注入，便于部署到 GitHub Pages 的子路径
 * （例如 /learning-hub/），本地开发默认使用根路径。
 */
export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), githubPagesFallback()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
