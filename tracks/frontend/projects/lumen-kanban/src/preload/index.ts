import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type Api } from '../shared/ipc';

/**
 * 预加载脚本运行在"隔离世界"：它有 Node 权限，但与页面 JS 不共享作用域。
 * 因此这里只把需要的能力以白名单方式暴露出去，绝不暴露 ipcRenderer 本身。
 */
const subscribe = (channel: string, callback: () => void): (() => void) => {
  const listener = (): void => callback();
  ipcRenderer.on(channel, listener);
  // 返回取消订阅函数：React 组件可以直接 return 它做清理
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api: Api = {
  appVersion: () => ipcRenderer.invoke(IpcChannel.AppVersion),

  exportData: (snapshot) => ipcRenderer.invoke(IpcChannel.ExportData, snapshot),

  importData: () => ipcRenderer.invoke(IpcChannel.ImportData),

  windowMinimize: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),

  windowToggleMaximize: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),

  windowClose: () => ipcRenderer.invoke(IpcChannel.WindowClose),

  onMenuNewCard: (callback) => subscribe(IpcChannel.MenuNewCard, callback),
  onMenuUndo: (callback) => subscribe(IpcChannel.MenuUndo, callback),
  onMenuRedo: (callback) => subscribe(IpcChannel.MenuRedo, callback),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api);
}
