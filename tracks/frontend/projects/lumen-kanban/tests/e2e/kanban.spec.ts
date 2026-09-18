import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * 端到端测试：驱动真实的 Electron 应用走一遍核心路径。
 *
 * 三个关键前提（都是踩过的坑）：
 * 1. 环境里若有 ELECTRON_RUN_AS_NODE=1，electron 会以纯 Node 启动，
 *    Playwright 拿不到调试通道，报 "Process failed to launch"。
 * 2. 无显卡/无显示的环境要 --disable-gpu，否则 GPU 进程崩溃直接退出。
 * 3. 用 LUMEN_USER_DATA 指定独立 userData，保证每个用例都从干净数据开始
 *    （否则种子数据只在第一次写入，断言会被历史数据干扰）。
 */
const root = process.cwd();
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const childEnv = { ...process.env } as Record<string, string | undefined>;
delete childEnv['ELECTRON_RUN_AS_NODE'];

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-e2e-'));

  app = await electron.launch({
    executablePath,
    args: ['.', '--no-sandbox', '--disable-gpu'],
    cwd: root,
    env: { ...childEnv, LUMEN_USER_DATA: userData },
  });

  page = await app.firstWindow();
  await page.waitForSelector('section', { timeout: 30_000 });
  // 等种子数据与动画稳定
  await page.waitForTimeout(1200);
});

test.afterEach(async () => {
  await app.close();
});

/** 只统计"可见"卡片：AnimatePresence 退场期间元素仍在 DOM 里 */
const visibleCards = () =>
  page.locator('section li').evaluateAll((nodes) =>
    nodes.filter((node) => parseFloat(getComputedStyle(node).opacity) > 0.5).length,
  );

const addCard = async (title: string): Promise<void> => {
  const input = page.locator('section input').first();
  await input.click();
  await input.pressSequentially(title);
  await input.press('Enter');
  await page.waitForTimeout(1200);
};

test('首次启动渲染三列与种子数据', async () => {
  await expect(page.locator('section')).toHaveCount(3);
  expect(await visibleCards()).toBe(4);
  await expect(page.locator('header').first()).toContainText('Lumen Kanban');
});

test('新增卡片后可撤销、可重做', async () => {
  const before = await visibleCards();

  await addCard('E2E-撤销验证');
  expect(await visibleCards()).toBe(before + 1);

  // exact: true —— 卡片标题里也可能含"撤销"二字，不精确匹配会命中多个元素
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForTimeout(1200);
  expect(await visibleCards()).toBe(before);
  await expect(page.getByText('E2E-撤销验证')).toHaveCount(0);

  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.waitForTimeout(1200);
  expect(await visibleCards()).toBe(before + 1);
  await expect(page.getByText('E2E-撤销验证')).toHaveCount(1);
});

test('撤销栈为空时按钮禁用', async () => {
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
});

test('搜索按标题过滤', async () => {
  await addCard('ZZZ-独特关键字');

  await page.locator('#search').click();
  await page.locator('#search').pressSequentially('ZZZ');
  await page.waitForTimeout(1200);

  expect(await visibleCards()).toBe(1);
  await expect(page.getByText('ZZZ-独特关键字')).toHaveCount(1);
});

test('刷新后数据仍在（本地持久化）', async () => {
  await addCard('E2E-持久化验证');
  const before = await visibleCards();

  await page.reload();
  await page.waitForSelector('section', { timeout: 30_000 });
  await page.waitForTimeout(1500);

  expect(await visibleCards()).toBe(before);
  await expect(page.getByText('E2E-持久化验证')).toHaveCount(1);
});

test('切换深色主题写入 data-theme', async () => {
  await page.getByRole('button', { name: '暗', exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: '亮', exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
