import path from 'node:path';
import fs from 'node:fs/promises';
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { IpcChannel, snapshotSchema } from '../shared/ipc';
import { err, ok } from '../shared/types';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';
const useDevServer = !app.isPackaged && Boolean(process.env['VITE_DEV_SERVER_URL']);

/**
 * 允许用环境变量指定 userData 目录。
 * 用途：E2E 测试每次从干净数据启动（否则种子数据只会在第一次写入，断言会受历史数据干扰）。
 * 附带好处：将来要做"便携版"也可以复用这个开关。
 */
const customUserData = process.env['LUMEN_USER_DATA'];
if (customUserData) {
  app.setPath('userData', customUserData);
}

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    // 无边框 + 自绘标题栏：跨平台视觉统一，代价是要自己实现最小化/最大化/关闭
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // 安全基线：以下四项缺一不可
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow = window;

  // 先渲染完再显示，避免白屏闪烁
  window.once('ready-to-show', () => window.show());

  // 安全：禁止页面导航到外部站点；外部链接一律交给系统浏览器
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith(DEV_SERVER_URL)) {
      event.preventDefault();
    }
  });

  if (useDevServer) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.AppVersion, () => app.getVersion());

  ipcMain.handle(IpcChannel.WindowMinimize, () => {
    mainWindow?.minimize();
  });

  ipcMain.handle(IpcChannel.WindowToggleMaximize, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.handle(IpcChannel.WindowClose, () => {
    mainWindow?.close();
  });

  ipcMain.handle(IpcChannel.ExportData, async (_event, payload: unknown) => {
    // 渲染进程传来的一切都不可信，先在边界上做运行时校验
    const parsed = snapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return err(`数据格式不合法：${parsed.error.issues[0]?.message ?? '未知错误'}`);
    }

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出看板数据',
      defaultPath: `lumen-kanban-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) return err('已取消导出');

    await fs.writeFile(result.filePath, JSON.stringify(parsed.data, null, 2), 'utf8');
    return ok(result.filePath);
  });

  ipcMain.handle(IpcChannel.ImportData, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入看板数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || result.filePaths[0] === undefined) return err('已取消导入');

    const raw = await fs.readFile(result.filePaths[0], 'utf8');

    try {
      const parsed = snapshotSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return err('文件内容不符合快照格式');
      return ok(parsed.data);
    } catch {
      return err('文件不是合法 JSON');
    }
  });
}

function buildMenu(): void {
  const send = (channel: string): void => {
    mainWindow?.webContents.send(channel);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '卡片',
      submenu: [
        {
          label: '新建卡片',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(IpcChannel.MenuNewCard),
        },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        {
          label: '撤销',
          // 快捷键交给主进程菜单统一处理：如果渲染进程再监听一次同按键，一次按键会撤销两步
          accelerator: 'CmdOrCtrl+Z',
          click: () => send(IpcChannel.MenuUndo),
        },
        {
          label: '重做',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send(IpcChannel.MenuRedo),
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  nativeTheme.themeSource = 'system';
}

void app.whenReady().then(async () => {
  registerIpc();
  buildMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
