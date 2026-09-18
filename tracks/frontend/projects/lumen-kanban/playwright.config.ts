import { defineConfig } from '@playwright/test';

/**
 * 注意：这里跑的是 Electron 应用（用 playwright 的 _electron 驱动），
 * 不是浏览器，所以不需要下载 Chromium —— 安装时可用
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 跳过浏览器下载。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Electron 应用进程较重，且共用 userData 会互相干扰，串行跑最稳
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
});
