import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * 主进程 + 预加载脚本的构建配置。
 *
 * 为什么不用 electron-vite：electron-vite@5 的 peer 是 vite ^5||^6||^7，
 * 不支持 Vite 8。所以这里用 Vite 8 的 lib 模式手写多入口构建。
 *
 * 输出 CJS 而不是 ESM：Electron 43 对 ESM 的支持仍有边界（如预加载脚本、
 * 部分原生模块），CJS 是当下最稳的选择。
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    lib: {
      name: 'lumen',
      entry: {
        main: 'src/main/index.ts',
        preload: 'src/preload/index.ts',
      },
      formats: ['cjs'] as const,
      fileName: (format, name) => `${name}.${format === 'cjs' ? 'cjs' : 'js'}`,
    },
    rollupOptions: {
      // electron 与所有 Node 内置模块都不能被打进产物
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
    minify: false,
  },
});
