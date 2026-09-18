# 阶段 10：Electron 43 桌面应用

| 项目 | 内容 |
| --- | --- |
| **周期** | 3 周（约 30 小时） |
| **前置** | 完成阶段 7（React 应用完整）、阶段 9（Dexie 4 本地数据层，离线优先数据落地） |
| **本阶段技术栈** | Electron 43 · Vite 8 · React 19.2 · TypeScript 7 · Tailwind CSS 4.3 · Zustand 5 · Dexie 4 · electron-vite / Electron Forge · electron-builder · Vitest · Playwright |
| **产出物** | 把 Web 应用打包成可安装的桌面应用：多窗口、原生菜单、系统托盘、全局快捷键、本地文件读写、自动更新 |

> ⚠️ **版本要点（2026-09 验证）**：Electron 43（2026-07-02）内置 **Chromium 150.0.7871.46 / V8 15.0 / Node 24.17.0**；启动性能显著优化（主进程 Node 启动快照、preload 编译为 V8 字节码）；**32 位平台支持已终止**。43 新增通知管理 API、`globalShortcut.setSuspended()`、`app.configureWebAuthn()`。内部 Node 24.17 版本需要你本机的 Node 也对齐到 24 LTS 来管理原生模块的 ABI（见 3.1 与 3.10）。

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 9 你已经用 Dexie 4 把结构化数据落到 IndexedDB，做出了**离线优先的数据层**——断网也能增删改，再考虑后台同步。但应用还只能在浏览器标签页里跑，拿不到文件系统、菜单、托盘、通知这些桌面能力。
- **本阶段**：用 Electron 43 给这套 Web 技术栈套一层原生壳。你要把已经写熟的 React + Vite + TS 代码，放进「主进程 / 渲染进程 / preload」三进程模型里，并补上**安全模型**、**IPC（进程间通信）**、**窗口与菜单**、**打包签名**四块纯桌面知识。核心概念是**进程边界**与**跨边界的类型安全通信**。
- **下接**：阶段 11（[阶段 11：综合实战与持续进阶](./11-综合实战与持续进阶.md)）会把阶段 1~10 的能力整合成一个作品级项目，收口 README 的**里程碑 M4（作品）**。本阶段产出的桌面壳，正是 M4 项目需要直接复用的底座。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 画出 Electron 的**进程模型**：主进程（Node，唯一，管生命周期与原生能力）× 渲染进程（Chromium，可多个，跑 UI）× 工具进程 / preload 脚本，并说清各自的信任边界。
2. 建立**安全基线**：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` + preload + `contextBridge` 白名单 IPC，能说清每一项防的是什么攻击。
3. 设计**类型安全的 IPC 层**（主进程与渲染进程共享类型定义，编译期校验），并支持请求-响应、事件推送、渲染进程间通信三种模式。
4. 掌握窗口管理：`BrowserWindow` 生命周期、多窗口、无边框与自定义标题栏、窗口状态持久化、深浅色跟随系统。
5. 掌握原生集成：应用菜单、上下文菜单、系统托盘、全局快捷键、通知、文件对话框与拖拽、系统主题、协议注册（deep link）。
6. 掌握本地能力：文件系统读写、SQLite / IndexedDB（复用阶段 9 的 Dexie 4）、数据存放路径（`app.getPath('userData')`）、日志。
7. 掌握**打包分发与更新**：Electron Forge / builder 配置、代码签名（概念与流程）、asar、自动更新（electron-updater），并理解三平台差异。
8. 掌握**性能与体积**：启动优化、冷启动指标、按需加载、依赖裁剪，并在发布前跑一遍安全清单。

---

## 三、核心概念详解

### 3.1 进程模型：主进程 / 渲染进程 / preload 的分工

**是什么**：Electron 本质是把 Chromium（渲染网页）和 Node.js（跑系统能力）焊在同一个二进制里。**主进程（main process）** 是那个唯一的 Node 进程，负责应用生命周期、原生 API（`BrowserWindow`、`Menu`、`Tray`、`dialog`）；**渲染进程（renderer process）** 是一个个 Chromium 实例，跑你的 React UI；**preload 脚本** 是夹在两者之间的桥，在主进程加载页面前注入，运行在隔离上下文里。还有 **Utility Process（工具进程）** 用来隔离 CPU 密集或不可信的第三方原生模块。

**为什么需要**：浏览器网页默认拿不到文件系统与进程能力（安全设计），桌面应用却必须调用。Electron 的解法是「主进程持原生能力、渲染进程只跑 UI、preload 做受控桥接」，既给能力又不交给不可信页面。对照 Java：JVM 单进程内 EDT 与业务线程共存；Electron 把「UI 渲染」与「系统能力」拆成进程，靠 IPC 通信。

**怎么用**。先看标准项目结构，再分别看三份代码怎么对应：

```ts
// 推荐的目录结构（src 下按进程拆分）
app/
├── src/
│   ├── main/            # 主进程（Node 环境）：窗口、菜单、IPC handler、原生能力
│   │   ├── index.ts
│   │   ├── windows.ts
│   │   └── ipc/
│   ├── preload/         # 隔离世界的桥接层：contextBridge.exposeInMainWorld
│   │   └── index.ts
│   ├── renderer/        # 渲染进程（Chromium）：React 应用本体
│   └── shared/          # 两端共享的类型 / 常量 / IPC 通道枚举（单一真源）
└── electron.vite.config.ts
```

主进程的生命周期（注意三个进程的启动顺序）：

```ts
// main/index.ts —— 主进程入口
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // preload 在页面 JS 之前注入，是主/渲染之间唯一的受控桥
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 开发时加载 Vite dev server；生产时加载打包后的 index.html
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// 应用就绪 → 注册 IPC → 创建窗口；macOS 激活时补窗
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 非 macOS 在最后一个窗口关闭后退出（macOS 习惯保留在坞里）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

**坑在哪**：

- 渲染进程**永远不要**直接 `require('fs')`——沙箱 + 关 `nodeIntegration` 后不可用，必须走 IPC。
- 本机 Node 版本要对齐内置 Node 24.17：原生模块按 Node 的 ABI 编译，差一点就报 `compiled against a different Node.js version`。阶段 0 装 24 LTS 正是为此。
- preload 编译进 V8 字节码是 Electron 43 的启动优化；**不要手写动态 `require`** 绕过，否则优化失效且破坏安全。

### 3.2 安全模型四件套：contextIsolation + sandbox + preload + contextBridge

**是什么**：这是 Electron 的**安全三件套**（`contextIsolation` / `sandbox` / `preload`）加 `contextBridge`。四者合起来保证：页面里的远程/不可信 JS 拿不到 Node 能力，只能通过你白名单暴露的少量函数与主进程对话。

**为什么需要**：很多 Electron 漏洞源于「图省事」开了 `nodeIntegration: true`——页面脚本能 `require('child_process').exec('rm -rf /')`，等于把整个系统权限交给可能被 XSS 攻陷的网页。四件套把渲染进程关进沙箱，并把「能给页面的能力」收敛成你逐个列出的白名单函数。

**怎么用**。先给窗口上安全基线：

```ts
// main/windows.ts —— 安全基线四个开关：隔离上下文 / 关 Node 能力 / 沙箱 / 浏览器安全机制
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,        // ① preload 与页面各自独立 JS 上下文
    nodeIntegration: false,         // ② 页面不能直接用 Node API
    sandbox: true,                  // ③ 渲染进程跑在 Chromium 沙箱，被攻陷也拿不到系统权限
    webSecurity: true,              // ④ 同源策略等浏览器安全机制保持开启
    allowRunningInsecureContent: false,
  },
});
```

再用 `contextBridge` 只暴露白名单函数（见 3.3 的 preload 示例）。生产环境还要关掉 DevTools 与调试端口：

```ts
// 只在开发环境开 DevTools；生产环境禁用 --inspect 远程调试端口
if (!app.isPackaged) {
  win.webContents.openDevTools({ mode: 'detached' });
}
```

**坑在哪**：

- **绝不开 `nodeIntegration: true`** 来「让页面能读写文件」——这是把 RCE 写进产品。正确做法永远是「页面发 IPC → 主进程读写 → 返回结果」。
- **不要把整个 `ipcRenderer` 暴露出去**：`exposeInMainWorld('electron', ipcRenderer)` 等于把 `ipcRenderer.send` 交给页面，攻击者可伪造任意 IPC 调任何 handler。只暴露白名单函数。
- `contextIsolation: false` 时 preload 与页面共享同一个 `window`，preload 的 Node 对象会被页面看到——老教程写法，2026 年绝对不要沿用。

### 3.3 类型安全的 IPC 设计（单一真源）

**是什么**：IPC（Inter-Process Communication，进程间通信）是渲染进程和主进程交换数据的机制。类型安全的 IPC 指：把通道名、`Api` 接口、DTO（数据传输对象）、`Result` 类型都定义在一个 `shared/` 文件里，主进程、preload、渲染进程**三处共用同一份类型**，编译期就能发现不一致。

**为什么需要**：IPC 是跨进程的「字符串通道 + 任意 JSON」——如果三处各写各的类型，改了 handler 忘记改 preload，运行期才崩，且错误栈跨进程很难追。单一真源让 `tsc` 替你守住这道边界，是大型 Electron 应用不腐化的关键。

**怎么用**。共享层定义通道与接口：

```ts
// shared/ipc.ts —— 三处共享的单一真源
export const IpcChannel = {
  ReadDir: 'fs:read-dir',
  UpsertCard: 'card:upsert',
  OnSyncProgress: 'sync:progress',
} as const;

export interface Card {
  id: string;
  title: string;
  done: boolean;
}

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface Api {
  readDir(dirPath: string): Promise<Result<string[]>>;
  upsertCard(card: Card): Promise<Result<void>>;
  // 事件订阅必须返回取消函数，组件卸载时调用，否则内存泄漏
  onSyncProgress(cb: (progress: number) => void): () => void;
}
```

preload 实现 `Api` 并用 `contextBridge` 暴露：

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type Api } from '../shared/ipc';

const api: Api = {
  readDir: (dirPath) => ipcRenderer.invoke(IpcChannel.ReadDir, dirPath),
  upsertCard: (card) => ipcRenderer.invoke(IpcChannel.UpsertCard, card),
  onSyncProgress: (cb) => {
    const listener = (_event: unknown, progress: number) => cb(progress);
    ipcRenderer.on(IpcChannel.OnSyncProgress, listener);
    return () => ipcRenderer.removeListener(IpcChannel.OnSyncProgress, listener);
  },
};

contextBridge.exposeInMainWorld('api', api); // 全局只挂一个 api，页面通过 window.api 调用
```

主进程 `handle` 实现，并用 zod 校验入参（**渲染进程的一切输入都不可信**）：

```ts
// main/ipc.ts
import { ipcMain } from 'electron';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { IpcChannel, type Api, type Card, type Result } from '../shared/ipc';

const CardSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  done: z.boolean(),
});

export function registerIpc() {
  ipcMain.handle(IpcChannel.ReadDir, async (_e, dirPath: string): Promise<Result<string[]>> => {
    try {
      const entries = await readdir(dirPath);
      return { ok: true, value: entries };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.UpsertCard, async (_e, raw): Promise<Result<void>> => {
    const parsed = CardSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const card = parsed.data as Card;
    return { ok: true, value: undefined };
  });
}
```

渲染进程通过 `declare global` 拿到 `window.api` 的类型：

```ts
// renderer/src/types/global.d.ts
import type { Api } from '../../shared/ipc';

declare global {
  interface Window {
    api: Api;
  }
}
```

**坑在哪**：

- 渲染进程里 `window.api` 是 `any` 还是 `Api`，取决于有没有声明 `declare global`。没声明会失去全部类型保护——务必放在 `global.d.ts` 里。
- handler 端 zod 校验不能省：渲染进程可能被注入脚本伪造请求，主进程必须把自己当「不可信边界」对待。

### 3.4 IPC 三种模式：invoke/handle、send/on、渲染进程间通信

**是什么**：Electron 的 IPC 按「通信方向与是否需要回执」分三种。**请求-响应** 用 `ipcRenderer.invoke` / `ipcMain.handle`（渲染进程发、主进程回，返回 Promise）；**单向推送** 用 `ipcRenderer.send` / `ipcMain.on`（不等待回执，适合事件通知）；**渲染进程间通信** 走 `webContents.send` 或 `BroadcastChannel`，让多个窗口互相通知。

**为什么需要**：不是所有通信都要回执。读文件要等结果（请求-响应）；「窗口 A 改了主题，通知窗口 B」只需推一把（单向）；「主进程算完同步进度，推给渲染进程」也是单向推。选错模式会写出一堆无谓的 `await`。

**怎么用**：

```ts
// 模式一：请求-响应（invoke / handle），返回 Promise
const res = await window.api.readDir('/Users/me/Documents'); // 主进程用 ipcMain.handle 实现，见 3.3

// 模式二：单向推送（send / on），不回执
mainWindow.webContents.send(IpcChannel.OnSyncProgress, 0.42); // 渲染进程在 preload 里 ipcRenderer.on 订阅

// 模式三：渲染进程间通信（多窗口广播，主进程中转）
ipcMain.on('window:relay', (event, payload) => {
  const sender = event.sender;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents !== sender) win.webContents.send('window:relay', payload);
  }
});
// 更轻量方案：同源窗口直接用 BroadcastChannel，无需经过主进程
const channel = new BroadcastChannel('kanban-sync');
channel.postMessage({ type: 'theme', value: 'dark' });
```

**坑在哪**：

- `invoke` / `handle` 是**成对**的：渲染端用 `invoke`，主端必须用 `handle`（不是 `on`），否则拿到的是 `undefined` 的 Promise 永远不 resolve。
- 单向 `send` 配 `on` 时，事件订阅**必须返回取消函数**并在组件卸载时调用（见 3.3 的 `onSyncProgress` 写法），否则窗口关闭后 handler 还在堆回调，内存泄漏 + 重复触发。

### 3.5 BrowserWindow 与窗口管理

**是什么**：`BrowserWindow` 是 Electron 里一个浏览器窗口的封装，对应一个渲染进程。它管尺寸、位置、显隐时机、边框、背景色，以及加载哪个 URL/文件。

**为什么需要**：桌面应用的「窗口体验」直接决定产品质感。白闪、启动慢、无边框后拖不动、重启后窗口乱跑，都是没管好 `BrowserWindow` 的典型症状。

**怎么用**：

```ts
// 避免白闪：先不显示，等 ready-to-show 再 show；backgroundColor 与页面底色一致
const win = new BrowserWindow({
  width: 1200,
  height: 800,
  show: false,
  backgroundColor: '#0f172a',
  webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
});
win.once('ready-to-show', () => win.show());

// 无边框窗口 + 自绘标题栏（渲染进程用 CSS：.titlebar { -webkit-app-region: drag; }，按钮标 no-drag）
const frameless = new BrowserWindow({
  frame: false,
  titleBarStyle: 'hidden',
  webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
});

// 窗口状态持久化（位置/尺寸记忆，二次启动恢复）
import Store from 'electron-store';
const store = new Store();
const bounds = store.get('winBounds') as Electron.Rectangle | undefined;
if (bounds) win.setBounds(bounds);
win.on('close', () => store.set('winBounds', win.getBounds()));
```

深浅色跟随系统，与 Tailwind 的 `dark:` 联动：

```ts
// 主进程监听系统主题变化，推给渲染进程（渲染进程收到后切 className，Tailwind 的 dark: 即生效）
import { nativeTheme } from 'electron';
nativeTheme.themeSource = 'system'; // 'system' | 'light' | 'dark'
nativeTheme.on('updated', () => mainWindow.webContents.send('theme:updated', nativeTheme.shouldUseDarkColors));
```

**坑在哪**：

- **多窗口之间的状态同步**别各自写一套——用共享 store（Zustand 5 的 `persist` + `BroadcastChannel`）或 IPC 广播，集中一处。窗口多了之后「谁听谁的」最容易乱。
- 无边框窗口的按钮如果忘记标 `no-drag`，点击会当成拖拽，按钮失灵。

### 3.6 菜单 / 托盘 / 通知 / 全局快捷键

**是什么**：这些是桌面的「原生外壳」体验。`Menu` 构建应用菜单与右键上下文菜单（macOS 上还有顶栏应用菜单）；`Tray` 是系统托盘图标；`Notification` 是系统通知；`globalShortcut` 是全局快捷键（应用没焦点也能触发）。

**为什么需要**：用户期待桌面应用有 Cmd/Ctrl+Q 退出、右键菜单、托盘常驻、全局唤起草稿——这些是浏览器给不了的「桌面感」，也是 M4 作品级项目的验收点。

**怎么用**：

```ts
// 应用菜单用 role 复用系统标准项，跨平台自动本地化
import { Menu, Tray, Notification, globalShortcut, app, BrowserWindow } from 'electron';
import path from 'node:path';

const template: Electron.MenuItemConstructorOptions[] = [
  { role: 'appMenu' },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { label: '看板', submenu: [{ label: '快速新增', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('action:quick-add') }] },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));

// 系统托盘：点击恢复窗口，右键菜单退出
let tray: Tray | null = null;
app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, '../../assets/tray.png'));
  tray.setToolTip('Lumen Kanban');
  tray.on('click', () => mainWindow?.show());
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示', click: () => mainWindow?.show() }, { label: '退出', role: 'quit' }]));
});

// 全局快捷键：Electron 43 新增 setSuspended() 可临时挂起所有快捷键
app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+K', () => mainWindow?.webContents.send('action:quick-add'));
  globalShortcut.setSuspended(true); // 43 新增：窗口失焦时挂起，避免与其它应用冲突
});

// 通知：Electron 43 新增 macOS 的 remove / removeAll / removeGroup / getHistory
new Notification({ title: '同步完成', body: '12 张卡片已更新' }).show();
```

**坑在哪**：

- 全局快捷键**必须在 `app.whenReady()` 之后注册**，退出时 `globalShortcut.unregisterAll()`，否则下次启动报「已占用」。
- macOS 托盘图标要用**模板图标**（@2x.png + 透明通道），否则深色模式看不清。
- Electron 43 的 `Notification` 新增管理方法在旧系统不存在，用 `typeof Notification.removeAll === 'function'` 兜底。

### 3.7 原生能力：文件系统、对话框、系统主题

**是什么**：桌面应用区别于网页的核心能力——直接读写文件系统、弹出系统文件选择框、感知系统主题。这些都只能在主进程调用，再通过 IPC 交给渲染进程。

**为什么需要**：阶段 9 的 Dexie 4 只解决「结构化数据离线存」。但「导出看板为 JSON 到用户指定位置」「导入一个文件」「跟系统深浅色」是产品级必备，浏览器做不到（或只能走受限的下载/上传）。

**怎么用**：

```ts
// 主进程：文件对话框 + 读写用户选定的路径（绝不信任渲染进程拼路径）
import { dialog } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';

ipcMain.handle('export:file', async (_e, content: string) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出看板',
    defaultPath: 'kanban-export.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, error: '用户取消' };
  await writeFile(filePath, content, 'utf-8');
  return { ok: true, value: undefined };
});

ipcMain.handle('import:file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false, error: '用户取消' };
  const text = await readFile(filePaths[0], 'utf-8');
  return { ok: true, value: text };
});
```

数据该放哪——**永远用 `app.getPath()`，别写安装目录**：

```ts
import { app } from 'electron';
app.getPath('userData');   // 用户专属应用数据目录（推荐放数据库/配置）
app.getPath('documents');  // 文档
app.getPath('downloads');  // 下载
app.getPath('temp');       // 临时
// 安装目录（process.resourcesPath）在更新时会被整体覆盖且可能无写权限，千万别写
```

**坑在哪**：

- 数据写到安装目录 = 更新时被覆盖 + 无写权限。**一律 `app.getPath('userData')`**。
- 路径用相对路径会炸：打包后 cwd 变化。用 `app.getPath()` 或 `app.isPackaged` 分支处理资源路径。

### 3.8 与 Vite 8 集成开发（concurrently 起双进程 + HMR）

**是什么**：开发期你需要**两个进程同时跑**——Vite 8 dev server 提供渲染进程的 HMR（热更新），Electron 主进程加载这个 dev server 的 URL。用 `concurrently` 一条命令同时拉起，用 `electron-vite` 或手写脚本管理。

**为什么需要**：浏览器开发只跑一个 Vite；Electron 还要起主进程。手动开两个终端太累，且主进程改了要重启 Electron。集成好后，渲染进程改代码 HMR 秒更，主进程改代码自动重启。

**怎么用**（手写 `concurrently` 方案，不引入额外框架）：

```jsonc
// package.json —— 用 concurrently 并行启动 Vite 与 Electron
{
  "scripts": {
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "dev": "concurrently -n vite,electron -c green,cyan \"pnpm dev:renderer\" \"wait-on http://localhost:5173 && pnpm dev:main\""
  },
  "devDependencies": { "concurrently": "^9.0.0", "wait-on": "^8.0.0" }
}
```

```ts
// main/index.ts —— 根据环境变量决定加载 dev server 还是打包产物
const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
if (isDev) win.loadURL(DEV_URL);
else win.loadFile(path.join(__dirname, '../renderer/index.html'));
```

更省事的是用官方脚手架 `electron-vite`，一份配置管主/预加载/渲染三套构建：

```ts
// electron.vite.config.ts
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { build: { rollupOptions: { output: { format: 'esm' } } } },
  preload: { build: { rollupOptions: { output: { format: 'esm' } } } },
  renderer: { plugins: [react()] }, // 渲染进程用 Vite 8 + Rolldown，HMR 照旧
});
```

**坑在哪**：

- Vite 8 要求本机 Node 20.19+ / 22.12+，Electron 43 内置 Node 24.17——开发机装 Node 24 LTS 即可两头都满足。
- `loadURL` 加载 `http://localhost` 时，**不要**给渲染进程开 `webSecurity: false` 来「绕过 CORS」；开发期可临时用 `win.webContents.session.webRequest` 放行，但生产必须走 CSP。

### 3.9 数据落地：与 Dexie 4 组合做离线优先

**是什么**：阶段 9 你已经用 Dexie 4 把数据存进 IndexedDB，跑在渲染进程里。Electron 里这份代码**几乎原样复用**——渲染进程就是 Chromium，IndexedDB 照常可用。Dexie 4 的 `useLiveQuery` 让 UI 响应本地数据变化，天然离线优先。

**为什么需要**：桌面应用的核心卖点之一是「断网也能用」。把 Dexie 作为本地真源，UI 直接读本地；联网时再后台同步到远端（用 MSW 或自建 mock server 做练习）。这比「每次都请求服务器」体验好太多，也是 M4 作品的硬性验收点。

**怎么用**（复用阶段 9 的 Dexie 层，只补「导入导出走主进程」的桥）：

```ts
// renderer/src/data/db.ts —— 阶段 9 的 Dexie 4 schema 直接复用
import Dexie, { type Table } from 'dexie';

export interface CardRecord {
  id: string;
  boardId: string;
  title: string;
  done: boolean;
  updatedAt: number;
}

export class KanbanDB extends Dexie {
  cards!: Table<CardRecord, string>;
  constructor() {
    super('kanban');
    this.version(1).stores({ cards: 'id, boardId, done, updatedAt' });
  }
}
export const db = new KanbanDB();

// 导出：从 Dexie 读出 → 交给主进程写文件（渲染进程不碰 fs）
export async function exportBoard(boardId: string) {
  const cards = await db.cards.where('boardId').equals(boardId).toArray();
  return window.api.exportFile(JSON.stringify(cards, null, 2));
}

// 导入：主进程读文件 → 渲染进程写回 Dexie
export async function importBoard() {
  const res = await window.api.importFile();
  if (!res.ok) return res;
  const cards = JSON.parse(res.value) as CardRecord[];
  await db.cards.bulkPut(cards); // bulkPut：存在则更新，不存在则插入
  return { ok: true, value: undefined };
}
```

**坑在哪**：

- 渲染进程里的 Dexie 数据**只属于这个窗口的 IndexedDB 源**，多窗口共享同一 `userData` 下的 IndexedDB 是可行的，但并发写要用 Dexie 事务，别各自裸写。
- 导入时**必须先 zod 校验再 `bulkPut`**，否则坏数据进了本地真源，整个应用读到的都是脏数据。

### 3.10 打包与代码签名（Electron Forge / builder、平台差异）

**是什么**：把开发态的代码「封箱」成用户能双击安装的产物。Electron Forge（官方推荐，内置 Vite 插件）或 `electron-builder` 都能干；产物先打进 **asar**（只读归档，防用户随手改源码），再按平台生成 `.dmg` / `.exe` / `.AppImage`；**代码签名** 给产物盖「可信发布者」章，否则用户打开会被系统拦截。

**为什么需要**：没打包你只有一个 `electron .` 的开发命令；没签名用户双击就被系统报「未知开发者」。三平台签名机制完全不同，且 Electron 41+ 的 macOS **ASAR Integrity digest** 要求重新签名，跳过会启动崩溃。

**怎么用**（Electron Forge，Vite 模板）：

```js
// forge.config.js —— 签名配置通过 CI 环境变量注入，别写进仓库
module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.lumen.kanban',
    osxSign: {},
    osxNotarize: process.env.APPLE_ID
      ? { appleId: process.env.APPLE_ID, appleApiKey: process.env.APPLE_API_KEY }
      : undefined,
    win32metadata: { CompanyName: 'Lumen' },
  },
  rebuildConfig: { force: true }, // 原生模块按当前 Electron 版本重建
  makers: [
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'] },
    { name: '@electron-forge/maker-deb', platforms: ['linux'] },
  ],
};
```

```bash
# 三平台构建（CI 矩阵分别跑，本地一般只打当前平台）
pnpm exec electron-forge make   # Windows: Authenticode；macOS: Developer ID + notarization；Linux: 免签
```

**坑在哪**：

- **原生模块 ABI 不匹配**：用 `electron-rebuild` 或优先选 N-API 模块（N-API 跨 Node 版本稳定）。阶段 0 对齐 Node 24 正是为这里。
- **ASAR Integrity**：Electron 41+ 的 macOS 产物改动 asar 后必须重新签名，否则启动报完整性校验失败。用 `@electron/asar` v4.1+ 并在签名步骤覆盖。
- 签名/公证证书问题**提前 3~5 天处理**，别留到最后一周——这是作品级项目最常见的延期源。

### 3.11 自动更新（update.electronjs.org 或自建）

**是什么**：自动更新让用户不用手动下载新版本。`electron-updater` 是社区主流方案，既能对接官方免费的 `update.electronjs.org`（GitHub Releases 即可），也能对接自建更新服务器（返回统一 JSON 格式的 `latest.yml` / `release` 信息）。

**为什么需要**：桌面应用发版频率高于 Web，手动更新流失率高。自动更新是「可发布的产品」与「玩具」的分界之一。

**怎么用**：

```ts
// main/updater.ts —— 官方托管：把 GitHub Releases 设为更新源（无需自己写服务器）
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = false; // 先检测，用户确认再下

export function initUpdater(win: BrowserWindow) {
  autoUpdater.checkForUpdates();
  autoUpdater.on('update-available', (info) => win.webContents.send('updater:available', info.version));
  autoUpdater.on('download-progress', (p) => win.webContents.send('updater:progress', p.percent));
  autoUpdater.on('update-downloaded', () => win.webContents.send('updater:ready')); // 用户确认后调 quitAndInstall()
}
```

更新服务器返回的 JSON 约定（自建时）：

```json
{
  "version": "1.2.0",
  "files": [{ "url": "lumen-kanban-1.2.0.dmg", "sha512": "..." }],
  "path": "lumen-kanban-1.2.0.dmg",
  "releaseDate": "2026-09-10T00:00:00.000Z"
}
```

**坑在哪**：

- macOS 的自动更新必须走**已签名的产物 + notarization**，且 `autoUpdater` 不能更新正在运行的 app——要 `quitAndInstall()` 走 Squirrel/Sparkle 流程。
- 升级要**向后兼容老数据**：Dexie schema 版本迁移（阶段 9）必须覆盖「从 v1 升到 v2」，否则老用户更新后打不开。

### 3.12 体积与启动性能取舍

**是什么**：Electron 应用「体积大、启动慢」的吐槽源于它内嵌了整个 Chromium + Node。优化方向是**体积**（只打包生产依赖、裁剪 node_modules、双 package.json 结构）与**启动性能**（延迟加载、Node 启动快照、preload 字节码缓存）。

**为什么需要**：安装包 200MB+ 会劝退用户，冷启动 5 秒会被当卡死。Electron 43 的启动优化（主进程 Node 启动快照、preload 编译为 V8 字节码）正是冲这个问题来的。

**怎么用**：

```jsonc
// 双 package.json 结构：根目录只放元信息，真正依赖放 app/package.json（仅生产依赖打进 asar）
{
  "name": "lumen-kanban",
  "main": "dist/main/index.js",
  "dependencies": {}
}
```

```ts
// 冷启动优化：先出窗口，重模块等显示后再动态 import
app.whenReady().then(async () => {
  createWindow();
  const { initUpdater } = await import('./updater');
  initUpdater(mainWindow!);
});

// 性能监控：发布前量一遍
import { app } from 'electron';
const metrics = app.getAppMetrics(); // 各进程 CPU/内存
process.getProcessMemoryInfo().then((m) => console.log('RSS:', m.residentSetSize));
```

**坑在哪**：

- 把 `devDependencies` 打进 asar 是体积暴涨头号原因——确认打包只含 `app/package.json` 的 `dependencies`。
- 启动优化别过度：Node 启动快照对「主进程一启动就 import 一大堆」最有效；瓶颈在渲染进程时优化错地方（渲染优化同阶段 7）。

### 3.13 发布前安全清单

**是什么**：一份发布前必过的检查表，确保你没把任何一个安全开关关掉、没留任何 RCE 口子。Electron 的安全问题往往不是「功能没实现」，而是「为了方便开了危险选项」。

**为什么需要**：桌面应用跑在用户机器上、有完整系统权限，一个疏忽就是把用户电脑变成肉鸡。这份清单是发布门禁，CI 里也可以脚本化抽查关键配置。

**怎么用**（检查项，逐条确认后再发版）：

```ts
// 1. 安全基线：contextIsolation + nodeIntegration:false + sandbox 全开
// 2. 导航控制：只加载本地内容，外部链接走系统浏览器，禁止页面自己开新窗口
mainWindow.webContents.on('will-navigate', (e, url) => {
  if (new URL(url).origin !== 'http://localhost:5173' && !app.isPackaged) e.preventDefault();
});
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('https://')) require('electron').shell.openExternal(url);
  return { action: 'deny' };
});
// 3. 远程内容必须设 CSP；4. IPC 入参全部 zod 校验（渲染进程输入不可信）
// 5. 生产环境关闭 DevTools、禁用 --inspect；6. pnpm audit 跟进 CVE
// 7. 单实例锁：避免多开导致数据竞争
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
```

**坑在哪**：

- `will-navigate` 拦截漏了 `setWindowOpenHandler` 返回 `deny`，页面里的 `window.open` 仍能开外部站。两处都要堵。
- 忘了 `requestSingleInstanceLock`——双击桌面图标多开几个实例，各自写同一个 `userData` 数据库，数据直接竞争损坏。

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系 | 注意差异 |
| --- | --- | --- |
| JavaFX / Swing 桌面应用 | Electron 43 桌面应用 | Web 技术栈渲染 UI，不是原生控件；一套代码跨三平台，但体积更大 |
| 多进程与 RMI（远程方法调用） | Electron 的 IPC（`invoke/handle`、`send/on`、`contextBridge`） | 跨进程通信，payload 是 JSON（结构化克隆），不是 Java 对象引用 |
| `jpackage` / `JLink` 打包 | Electron Forge / `electron-builder` + asar | 产物是安装包而非 jar；三平台签名机制完全不同 |
| Java 的 `SecurityManager` / 沙箱 | Electron 的 `contextIsolation` + `sandbox` + `contextBridge` | 安全靠「关 Node 能力 + 白名单暴露」，不是靠 JVM 权限模型 |
| `java.io.File` / NIO | 主进程 `node:fs` + `dialog` | 渲染进程禁止直接碰文件系统，必须经 IPC 让主进程代劳 |
| `java.util.logging` / Log4j | `electron-log` + 崩溃上报 | 日志写进 `userData`，要轮转；渲染进程 OOM 堆栈 Electron 43 已支持 |
| JVM 进程内多线程 | 主进程 + 渲染进程 + Utility Process | 不是线程而是进程；CPU 密集任务放 Utility Process，别堵主进程 |
| `java -jar` 双击运行 | 安装包 + 代码签名 + 自动更新 | 用户不会跑命令，签名缺失会被系统拦截 |

---

## 五、实践练习

### 练习 1（必做）：最小安全骨架（4 小时）

**目标**：从零搭出主进程 + preload + React 渲染进程三件套，落实安全基线，实现一个「读取本机某目录文件名列表」功能，全程走 IPC。

**步骤**：

1. 用 `electron-vite` 或手写 `concurrently` 起双进程开发环境（见 3.8）。
2. `BrowserWindow` 开启 `contextIsolation` + `nodeIntegration: false` + `sandbox`（见 3.2）。
3. 写 `shared/ipc.ts` 定义 `readDir` 通道与 `Api`，preload 用 `contextBridge` 暴露，渲染进程 `declare global` 拿类型。
4. 主进程 `ipcMain.handle('fs:read-dir', ...)` 用 `node:fs/promises.readdir` 实现，返回 `Result<string[]>`。
5. 渲染进程调 `window.api.readDir(dir)` 展示列表。

**验收点**：关闭 `nodeIntegration` 后，渲染进程控制台执行 `require('fs')` 报错（证明拿不到 Node）；页面能正常列出目录内容。

### 练习 2（必做）：类型安全 IPC 层（5 小时）

**目标**：建立共享类型单一真源，主进程所有 handler 用 zod 校验，统一 `Result<T, E>` 返回，事件订阅返回取消函数。

**步骤**：

1. 把 `IpcChannel` / `Api` / `Result` / DTO 抽到 `shared/ipc.ts`。
2. 主进程每个 `handle` 用 zod 校验入参，错误走 `Result` 的 `ok: false` 分支。
3. 实现一个带取消函数的事件订阅（如同步进度推送），参考 3.3 的 `onSyncProgress`。
4. 在 React 组件里用它，并在 `useEffect` 清理函数里调用取消函数。
5. 写 IPC 契约测试：渲染端 mock `window.api`，断言 handler 返回结构。

**验收点**：改动 `Api` 接口一处，主进程与渲染进程编译期同时报错；故意传非法参数时返回 `ok: false` 而非崩溃。

### 练习 3（必做）：看板桌面化（8 小时）

**目标**：把阶段 9 的 Dexie 应用接入 Electron 外壳，补齐桌面体验。

**步骤**：

1. 自定义无边框标题栏（最小化/最大化/关闭 + 拖拽区，见 3.5）。
2. 应用菜单 + 上下文菜单 + 系统托盘（托盘点击恢复、托盘菜单退出）。
3. 全局快捷键 `Cmd/Ctrl+K` 打开快速新增。
4. 数据导出到用户选择位置（`showSaveDialog`）+ 导入（见 3.7）。
5. 系统主题跟随 + 应用内三态切换（系统/亮/暗）与 Tailwind `dark:` 联动。
6. 窗口位置尺寸记忆，二次启动恢复。

**验收点**：无边框窗口可拖拽、可最小化/最大化/关闭；托盘点击恢复窗口；切系统主题界面实时跟随。

### 练习 4（必做）：打包与更新（5 小时）

**目标**：打出当前平台安装包，接入自动更新，做一轮体积裁剪。

**步骤**：

1. 用 Electron Forge 或 `electron-builder` 打出当前平台安装包。
2. 配置应用图标（三平台）、应用 ID、版本号、版权信息。
3. 接入 `electron-updater`：本地起静态更新服务器，验证「检测更新 → 下载 → 安装重启」闭环（见 3.11）。
4. 记录产物体积，做一轮裁剪（双 package.json、只打生产依赖、按需加载），至少减少 15%。

**验收点**：安装包可双击安装并运行；模拟一次新版本，应用能检测到并下载；体积较前一轮下降 ≥ 15%。

### 练习 5（进阶）：多窗口与进程协作（4 小时）

**目标**：掌握多窗口状态同步与 Utility Process 隔离。

**步骤**：

1. 主窗口 + 独立「设置」窗口 + 一个始终置顶的小悬浮窗。
2. 悬浮窗与主窗口状态同步（IPC 广播或 `BroadcastChannel`）。
3. 把 1 万条数据校验的 CPU 密集任务放到 **Utility Process**，主进程保持流畅，对比前后响应。

**验收点**：悬浮窗操作实时反映到主窗口；CPU 密集任务运行时主窗口 UI 不卡顿。

### 练习 6（进阶）：原生能力集成（4 小时）

**目标**：补齐桌面原生能力，任选 3 项实现。

**步骤**（任选 3）：

- 系统通知（含 macOS 的分组与移除，见 3.6）
- 深链：浏览器 `myapp://board/123` 唤起应用并跳到对应看板（`app.setAsDefaultProtocolClient` + `second-instance`）
- 文件拖入窗口导入（`webContents` 的 `drop` 处理）
- 剪贴板：图片粘贴为附件
- `app.configureWebAuthn()` 做本地生物识别解锁（Electron 43 新增）

**验收点**：至少 3 项可演示；深链能在浏览器唤起应用并定位到目标看板。

### 练习 7（挑战）：可观测性与兜底（3 小时）

**目标**：让产品「出问题能查、能恢复」。

**步骤**：

1. 接入 `electron-log`，日志按大小轮转，提供「导出诊断包」。
2. 接入崩溃/未捕获异常上报（本地模拟即可）。
3. 处理：数据库损坏时的修复与恢复路径、更新失败回滚、`requestSingleInstanceLock` 单实例锁。

**验收点**：触发一次崩溃能生成诊断包；重复双击只起一个实例；数据库损坏时有恢复提示而非白屏。

---

## 六、常见坑与自查清单

### 高频坑

- 图省事开 `nodeIntegration: true` → 页面脚本拿到完整 Node 权限，等于 RCE。
- preload 里直接把 `ipcRenderer` 整个暴露 → 只能用 `contextBridge` 暴露白名单函数。
- IPC 事件订阅未在组件卸载时取消 → 内存泄漏 + 重复回调。
- 渲染进程里 `require('fs')` → 沙箱下不可用；必须走 IPC。
- 数据写到安装目录 → 更新时被覆盖、无写入权限。
- 路径用相对路径 → 打包后 cwd 变化，必须用 `app.getPath()` / `app.isPackaged` 分支。
- 原生模块 ABI 不匹配 → 用 `electron-rebuild` 或改用 N-API。
- 忘了 `requestSingleInstanceLock` → 多开导致数据竞争。
- 更新后 asar 完整性校验失败 → 41+ 的 ASAR Integrity 需重新签名。
- 本机 Node 版本与 Electron 内置 Node 24.17 不一致 → 原生模块加载报 ABI 错误。

### 自查清单

- [ ] 能画出主进程 / preload / 渲染进程三者的关系与信任边界。
- [ ] 安全基线四项全部开启（`contextIsolation` / `sandbox` / `nodeIntegration: false` / `contextBridge` 白名单），并能解释每项防的攻击。
- [ ] IPC 层有共享类型定义、zod 校验、统一的 `Result` 返回。
- [ ] 事件订阅返回取消函数并在卸载时调用。
- [ ] 应用有自定义标题栏、菜单、托盘、快捷键。
- [ ] 成功打出安装包并完成一次自动更新全流程。
- [ ] 数据存放于 `userData`，且有导入导出。
- [ ] 记录并优化过冷启动时间与产物体积。
- [ ] 发布前跑过 3.13 的安全清单，无危险选项开启。
- [ ] 本机 Node 已对齐到 24 LTS，原生模块可正常 `require`。

---

## 七、参考资料

- Electron 官方文档：Tutorial（进程模型）、Security、IPC、Native File Drag & Drop、Distribution —— https://www.electronjs.org/docs
- Electron 43 发布公告（2026-07-02）与 Planned Breaking Changes —— https://www.electronjs.org/blog/electron-43-0
- Electron Forge 文档 —— https://www.electronforge.io/
- `electron-builder` 文档 —— https://www.electron.build/
- `electron-updater` 文档 —— https://www.electron.build/auto-update
- `electron-vite` 模板与最佳实践 —— https://electron-vite.org/
- zod 校验库文档（IPC 入参校验）—— https://zod.dev/
- 验证时间：2026-09；版本事实（Electron 43 / Chromium 150.0.7871.46 / V8 15.0 / Node 24.17.0）以官方发布为准，与 `track.json` 的 `toolchain` 一致。
