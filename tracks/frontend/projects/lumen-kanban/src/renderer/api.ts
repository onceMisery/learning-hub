import type { Api } from '@shared/ipc';
import type { Snapshot } from '@shared/types';

/**
 * 同一份 Api 接口，两套实现。
 *
 * Electron 环境下 window.api 由 preload 通过 contextBridge 注入；
 * 纯浏览器开发（npm run dev）时降级到这里的浏览器实现。
 * 好处：业务代码只依赖接口，不依赖"我现在跑在哪个宿主里"。
 */
const browserFallback: Api = {
  appVersion: async () => 'web-dev',

  exportData: async (snapshot: Snapshot) => {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `lumen-kanban-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true, data: anchor.download };
  },

  importData: async () => ({ ok: false, error: '浏览器开发模式暂不支持导入，请在 Electron 中运行' }),

  windowMinimize: async () => {},
  windowToggleMaximize: async () => {},
  windowClose: async () => {},

  onMenuNewCard: () => () => {},
  onMenuUndo: () => () => {},
  onMenuRedo: () => () => {},
};

export const api: Api = window.api ?? browserFallback;
