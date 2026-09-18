/**
 * 运行应用并截图（纯 Electron API，无需额外依赖）。
 *
 * 用法：
 *   npm run build && npm run build:main
 *   npx electron scripts/capture.cjs
 *
 * 注意：
 *   - 若环境里设置了 ELECTRON_RUN_AS_NODE=1，electron 会以纯 Node 模式启动，
 *     此时 require('electron') 返回的是路径字符串。运行前需清除该变量。
 *   - 无显卡/无显示的环境需要禁用 GPU，否则 GPU 进程崩溃会导致窗口直接退出。
 *
 * 产物：screenshots/*.png + screenshots/capture-result.txt
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'screenshots');
const renderer = path.join(root, 'dist', 'renderer', 'index.html');
const preload = path.join(root, 'dist', 'preload.cjs');
const log = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  // 用临时 userData：每次都是"首次启动"（能看到种子数据），也不污染真实数据
  app.setPath('userData', path.join(os.tmpdir(), 'lumen-capture'));

  // 截图脚本只注册标题栏需要的版本号，其余 IPC 用不到
  ipcMain.handle('app:version', () => app.getVersion());

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    frame: false,
    // 显示窗口：capturePage 在隐藏窗口上可能拿到旧帧；也让使用者能亲眼看到运行过程
    show: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  win.webContents.on('console-message', (_e, _l, message) => {
    if (/error|Error|Uncaught/.test(message)) log.push(`CONSOLE: ${message}`);
  });

  await win.loadFile(renderer);
  win.show();
  await sleep(3500);

  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    log.push(`screenshot: ${name}.png`);
  };
  /**
   * 统计"可见"卡片数。
   * 为什么不能只数 li：退场动画期间元素仍在 DOM 里（AnimatePresence 要等动画结束才移除），
   * 直接计数会偏大。用 opacity 过滤掉正在退场的元素。
   */
  const countCards = () =>
    js(`[...document.querySelectorAll('section li')]
        .filter((li) => parseFloat(getComputedStyle(li).opacity) > 0.5).length`);

  /** 必须用真实键盘事件输入，才能触发 React 受控组件的更新 */
  const typeText = async (selector, text) => {
    await js(
      `(() => { document.querySelector(${JSON.stringify(selector)}).focus(); return true; })()`,
    );
    for (const ch of text) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
      await sleep(40);
    }
    await sleep(300);
  };

  log.push(`indexedDB available: ${await js('typeof indexedDB !== "undefined"')}`);
  log.push(`window.api: ${await js('window.api ? "injected" : "missing"')}`);
  log.push(`columns: ${await js('document.querySelectorAll("section").length')}`);
  log.push(`cards: ${await countCards()}`);
  log.push(
    `titlebar: ${await js('document.querySelector("header").innerText.trim().replace(/\\n/g, " ")')}`,
  );
  await shot('01-初始界面');

  // 新增卡片
  await typeText('section input', 'RunCheck-01');
  await js(`document.querySelector('section input').closest('form').requestSubmit(); true;`);
  await sleep(1000);
  log.push(`cards after add: ${await countCards()}`);
  await shot('02-新增卡片后');

  // 搜索过滤
  await typeText('#search', 'RunCheck');
  await sleep(1600);
  log.push(`search value: ${await js('document.querySelector("#search").value')}`);
  log.push(`cards after search: ${await countCards()}`);
  await shot('03-搜索过滤');

  // 重载页面清空搜索（query 不持久化）
  await win.reload();
  await sleep(2500);
  log.push(`cards after reload: ${await countCards()}`);

  // 只看高优先级（退场动画约 1 秒，等待要够长）
  const toggleHigh = `(() => {
    const box = [...document.querySelectorAll('label')]
      .find((l) => l.textContent.includes('高优先级'))
      .querySelector('input');
    box.click();
    return true;
  })()`;
  await js(toggleHigh);
  await sleep(1600);
  log.push(`cards onlyHigh: ${await countCards()}`);
  await shot('04-只看高优先级');
  await js(toggleHigh);
  await sleep(1600);

  // 深色主题
  await js(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '暗').click(); true;`,
  );
  await sleep(800);
  log.push(`theme: ${await js('document.documentElement.dataset.theme')}`);
  await shot('05-深色主题');

  // 卡片编辑弹窗
  await js(`document.querySelector('section li button').click(); true;`);
  await sleep(900);
  log.push(`dialog open: ${await js('document.querySelectorAll(\'[role="dialog"]\').length')}`);
  await shot('06-卡片编辑弹窗');

  fs.writeFileSync(path.join(outDir, 'capture-result.txt'), log.join('\n'), 'utf8');
  console.log(log.join('\n'));
}

void app.whenReady().then(async () => {
  await main();
  app.quit();
});
