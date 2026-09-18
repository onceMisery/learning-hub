/**
 * 端到端冒烟脚本：启动 Electron 应用 → 走一遍核心路径 → 截图。
 *
 * 用法：
 *   npm i -D playwright@1.63.0        # 可选依赖，Electron 模式无需下载浏览器
 *   npm run build && npm run build:main
 *   node scripts/smoke.mjs
 *
 * 产物：screenshots/*.png 与 screenshots/result.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const log = [];
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  log.push(`screenshot: ${name}.png`);
};

// 用项目里已安装的 Electron，避免 Playwright 联网下载它自己的版本
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const app = await electron.launch({ executablePath, args: ['.'], cwd: root });
const page = await app.firstWindow();

page.on('console', (msg) => {
  if (msg.type() === 'error') log.push(`CONSOLE_ERROR: ${msg.text()}`);
});
page.on('pageerror', (error) => log.push(`PAGE_ERROR: ${error.message}`));

await page.waitForTimeout(2500);

log.push(`title: ${await page.title()}`);
log.push(`columns: ${await page.locator('section').count()}`);
log.push(`cards: ${await page.locator('section li').count()}`);
log.push(`titlebar: ${(await page.locator('header').first().innerText()).replace(/\s+/g, ' ')}`);
await shot(page, '01-初始界面');

// 主题：暗 -> 亮
await page.getByRole('button', { name: '暗', exact: true }).click();
await page.waitForTimeout(600);
log.push(`theme after 暗: ${await page.evaluate(() => document.documentElement.dataset.theme)}`);
await shot(page, '02-深色主题');

await page.getByRole('button', { name: '亮', exact: true }).click();
await page.waitForTimeout(400);
log.push(`theme after 亮: ${await page.evaluate(() => document.documentElement.dataset.theme)}`);

// 快捷键新增卡片
await page.keyboard.press('Control+n');
await page.waitForTimeout(300);
await page.keyboard.type('RunCheck-01');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
log.push(`cards after add: ${await page.locator('section li').count()}`);
await shot(page, '03-新增卡片后');

// 搜索
await page.locator('#search').fill('RunCheck');
await page.waitForTimeout(600);
log.push(`cards after search: ${await page.locator('section li').count()}`);
await shot(page, '04-搜索过滤');
await page.locator('#search').fill('');
await page.waitForTimeout(400);

// 只看高优先级
await page.getByText('只看高优先级').click();
await page.waitForTimeout(600);
log.push(`cards onlyHigh: ${await page.locator('section li').count()}`);
await shot(page, '05-只看高优先级');
await page.getByText('只看高优先级').click();
await page.waitForTimeout(400);

// 卡片编辑弹窗
await page.locator('section li button').first().click();
await page.waitForTimeout(800);
log.push(`dialog count: ${await page.locator('[role="dialog"]').count()}`);
await shot(page, '06-卡片编辑弹窗');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
log.push(`dialog after Esc: ${await page.locator('[role="dialog"]').count()}`);

fs.writeFileSync(path.join(outDir, 'result.txt'), log.join('\n'), 'utf8');
await app.close();
console.log(log.join('\n'));
