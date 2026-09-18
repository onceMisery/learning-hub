const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const renderer = path.join(root, 'dist', 'renderer', 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

void app.whenReady().then(async () => {
  app.setPath('userData', path.join(os.tmpdir(), 'lumen-debug'));
  const win = new BrowserWindow({ width: 1180, height: 760, frame: false, show: false });
  await win.loadFile(renderer);
  await sleep(3000);

  const js = (code) => win.webContents.executeJavaScript(code);
  const counts = () =>
    js(`(() => {
      const all = [...document.querySelectorAll('section li')];
      const visible = all.filter((li) => parseFloat(getComputedStyle(li).opacity) > 0.5);
      return all.length + ' total / ' + visible.length + ' visible';
    })()`);

  console.log('初始:', await counts());

  await js(`(() => {
    [...document.querySelectorAll('label')].find((l) => l.textContent.includes('高优先级')).click();
    return true;
  })()`);

  for (const wait of [500, 1000, 2000, 3000]) {
    await sleep(wait === 500 ? 500 : 1000);
    console.log(`点击后 ${wait}ms:`, await counts());
  }

  console.log('可见卡片标题:', await js(`(() => [...document.querySelectorAll('section li')]
    .filter((li) => parseFloat(getComputedStyle(li).opacity) > 0.5)
    .map((li) => li.querySelector('button').textContent)
    .join(' | '))()`));

  app.quit();
});
