# 08 · 阶段 7：Electron 桌面化与发布

## 学完你能做什么

- 说清主进程 / 预加载 / 渲染进程的职责与**信任边界**
- 配出安全基线，并知道每一项防的是什么攻击
- 设计类型安全的 IPC 契约（共享类型 + zod 校验 + Result 返回）
- 把 Web 应用打成可安装的桌面应用

**前置**：阶段 4~6（应用本身已完成）。

---

## 1. 进程模型

```
┌─ 主进程（Node，唯一，有全部权限）──────────────┐
│  窗口管理、菜单、托盘、文件对话框、fs、系统 API │
└───────────────┬──────────────────────────────┘
                │  IPC（结构化克隆，异步）
┌───────────────┴──────────────────────────────┐
│ 预加载脚本（隔离世界，有 Node 权限但独立作用域）│
│ 只通过 contextBridge 暴露白名单函数             │
└───────────────┬──────────────────────────────┘
                │  window.api
┌───────────────┴──────────────────────────────┐
│ 渲染进程（Chromium，无 Node 权限，视为不可信）  │
│ React 应用                                     │
└──────────────────────────────────────────────┘
```

**核心原则**：渲染进程永远不直接碰 `fs` / `child_process`；一切原生能力走 IPC。

---

## 2. 安全基线（`src/main/index.ts`）

```ts
webPreferences: {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,     // 隔离 preload 与页面 JS
  nodeIntegration: false,     // 页面不获得 Node 能力
  sandbox: true,              // 渲染进程沙箱化
  webSecurity: true,
}
```

| 配置 | 防的是什么 |
| --- | --- |
| `contextIsolation: true` | 页面脚本篡改 `contextBridge` 暴露的 API、原型污染攻击 |
| `nodeIntegration: false` | 页面一旦被 XSS，攻击者直接拿到 `require('child_process')` = 完整 RCE |
| `sandbox: true` | 即使渲染进程被攻破，也无法逃出沙箱访问系统 |
| 导航拦截 | 页面被跳转到恶意站点后冒充你的应用 |
| IPC 入参校验 | 渲染进程是不可信的，恶意/被劫持的页面可以调用任意 IPC |

导航拦截（本项目代码）：

```ts
window.webContents.setWindowOpenHandler(({ url }) => {
  void shell.openExternal(url);      // 外链交给系统浏览器
  return { action: 'deny' };
});
window.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('file://') && !url.startsWith(DEV_SERVER_URL)) event.preventDefault();
});
```

---

## 3. 类型安全的 IPC 契约（三步）

### 第一步：共享契约（`src/shared/ipc.ts`）

```ts
export const IpcChannel = { AppVersion: 'app:version', ExportData: 'data:export', /* … */ } as const;

export const snapshotSchema = z.object({ /* zod 校验规则 */ });

export interface Api {
  appVersion(): Promise<string>;
  exportData(snapshot: Snapshot): Promise<Result<string>>;
  onMenuNewCard(callback: () => void): () => void;   // 返回取消函数
}

declare global { interface Window { api?: Api } }
```

### 第二步：主进程校验后再处理

```ts
ipcMain.handle(IpcChannel.ExportData, async (_event, payload: unknown) => {
  const parsed = snapshotSchema.safeParse(payload);          // ① 运行时校验
  if (!parsed.success) return err(`数据格式不合法：…`);

  const result = await dialog.showSaveDialog(mainWindow!, { /* … */ });
  if (result.canceled || !result.filePath) return err('已取消导出');   // ② 失败也是返回值

  await fs.writeFile(result.filePath, JSON.stringify(parsed.data, null, 2), 'utf8');
  return ok(result.filePath);                                 // ③ 统一 Result
});
```

### 第三步：preload 白名单暴露

```ts
const api: Api = {
  appVersion: () => ipcRenderer.invoke(IpcChannel.AppVersion),
  onMenuNewCard: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on(IpcChannel.MenuNewCard, listener);
    return () => ipcRenderer.removeListener(IpcChannel.MenuNewCard, listener);
  },
};
if (process.contextIsolated) contextBridge.exposeInMainWorld('api', api);
```

**为什么订阅函数要返回取消函数**：React 组件可以直接 `useEffect(() => api.onMenuNewCard(cb), [])`，卸载时自动清理，不会内存泄漏。本项目 `App.tsx` 就是这么写的。

**为什么要有浏览器降级实现**（`src/renderer/api.ts`）：

```ts
export const api: Api = window.api ?? browserFallback;
```

这样 `npm run dev` 在纯浏览器里也能跑（导出变成下载文件），业务代码不用写 `if (isElectron)`。

---

## 4. 无边框窗口与自绘标题栏

主进程：`frame: false, titleBarStyle: 'hidden'`。

渲染进程（`TitleBar.tsx`）：

```css
.titlebar-drag { -webkit-app-region: drag; }
.titlebar-drag button { -webkit-app-region: no-drag; }
```

**取舍**：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 原生标题栏（`frame: true`） | 零成本、系统集成好（最小化动画、双击最大化） | 跨平台样式不统一，深色模式下 Windows 标题栏很难看 |
| **无边框自绘（本项目）** | 视觉统一、可放业务控件 | 要自己实现最小化/最大化/关闭与拖拽；macOS 要留交通灯位置 |

**本项目为什么选自绘**：看板是沉浸式工具，标题栏要放版本信息与主题切换，自绘收益大于成本。

---

## 5. 构建与运行

```bash
npm run build          # 渲染进程 → dist/renderer
npm run build:main     # 主进程 + preload → dist/main.cjs, dist/preload.cjs
npm start              # build:main 后启动 Electron
```

**预期输出**（实测）：

```
dist/preload.cjs         1.47 kB
dist/main.cjs            5.95 kB
dist/ipc-*.cjs         168.70 kB      ← zod 被打进了共享 chunk
✓ built in 1.11s
```

**自动化验证（本项目实际执行，`npm run capture`）**：

`scripts/capture.cjs` 会启动应用、用真实键盘事件走一遍核心路径、每一步截图到 `screenshots/`。实测日志：

```
indexedDB available: true        ← file:// 协议下 IndexedDB 可用（关键前提）
window.api: injected             ← preload 经 contextBridge 注入成功
columns: 3 / cards: 4            ← 种子数据经事务写入并被 useLiveQuery 渲染
titlebar: Lumen Kanban · v43.7.0 ← 渲染进程 → IPC → 主进程 app.getVersion() 全链路通
cards after add: 5               ← 真实键盘输入 → React 受控表单 → Dexie 写入
cards after search: 1            ← 搜索过滤生效
cards after reload: 5            ← 重启后数据仍在（持久化）
cards onlyHigh: 2                ← Zustand 筛选生效（4 张中恰有 2 张高优先级）
theme: dark                      ← data-theme 切换生效
dialog open: 1                   ← 编辑弹窗打开
```

截图见 `screenshots/01-初始界面.png` ~ `06-卡片编辑弹窗.png`。

> 这条验证同时回答了一个重要问题：**`file://` 加载时 IndexedDB 是可用的**。如果你的目标平台出现 `indexedDB is not defined` 或 Dexie 打不开，改用自定义协议（`protocol.handle('app', …)`）加载渲染产物即可获得正式 origin。

手动验证清单：

1. 窗口出现三列看板（说明 `file://` 加载 + `base: './'` 生效）
2. 标题栏显示 `Lumen Kanban · v0.1.0`（说明 IPC 通）
3. 点 `- □ ✕` 三个按钮窗口有响应（说明自绘标题栏生效）
4. `Ctrl/Cmd + N` 聚焦第一列输入框（说明菜单 → IPC → React 通）
5. 点"导出"弹出保存对话框（说明主进程能力可达）

---

## 6. 打包分发

```bash
npm run dist
```

`package.json` 的 `build` 字段已配好三平台目标（Windows NSIS / macOS DMG / Linux AppImage）。

**必须知道的四件事**：

1. **图标**：`build/` 目录下需要 `icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（Linux）。缺图标会用 Electron 默认图标
2. **代码签名**：Windows 需要 Authenticode 证书，macOS 需要 Developer ID + 公证（notarization）。**没有签名的 macOS 应用会被 Gatekeeper 拦截，Windows 会报 SmartScreen 警告** —— 这是分发环节最大的坑，请预留 3~5 天处理证书
3. **asar**：默认会把代码打成 `app.asar`。Electron 41+ 支持 macOS 的 ASAR Integrity digest（需 `@electron/asar` v4.1+ 且**签名后要重签**）
4. **自动更新**：本项目未接入。生产需要时加 `electron-updater` + 一个返回固定 JSON 格式的更新服务器

**体积优化方向**：`dist/renderer` 里 486KB（gzip 155KB）中 React + Motion + Dexie 占大头。可做的：路由级懒加载、用 `m` + `LazyMotion` 替代完整 `motion`、把 zod 只在主进程用（渲染进程不打包）。

---

## 7. 本阶段踩坑速查

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 窗口全白 | 用了绝对路径资源 | `vite.config.ts` 设 `base: './'` |
| `Cannot find module 'dist/main.cjs'` | 没跑 `build:main` | 先 `npm run build:main` |
| `require is not defined` | 产物是 ESM 但 Electron 按 CJS 加载 | 主进程产物用 `formats: ['cjs']` |
| `electron` 被打进产物导致巨大/报错 | 没 external | `rollupOptions.external` 排除 electron 与所有内置模块 |
| preload 没生效 / `window.api` 是 undefined | 路径写错或未开 `contextIsolation` | 检查 `preload` 路径；确认 `process.contextIsolated` 分支 |
| 窗口白屏闪一下 | 还没渲染完就 show | `window.once('ready-to-show', () => window.show())` |
| 数据写到安装目录后更新丢失 | 路径不对 | 一律用 `app.getPath('userData')` |
| `npm i electron@43.7.1` 报 ETARGET | 版本不存在 | `npm view electron@43 version` 查真实版本（本项目用 43.7.0） |
| electron-vite 报 peer 冲突 | 它只支持 Vite 5/6/7 | 用 Vite 8 多入口手写配置（本项目做法） |
