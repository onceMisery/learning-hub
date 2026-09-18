import { useEffect } from 'react';
import { useHistoryStore } from '@/history/store';

const isTextField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
};

/**
 * 键盘快捷键。
 *
 * 两个刻意的设计：
 * 1. 焦点在输入框里时不劫持 Ctrl+Z —— 用户在输入时按撤销，期望的是"撤销我刚打的字"，
 *    而不是"撤销上一次数据库操作"。
 * 2. Electron 环境下不在这里处理，交给主进程的菜单快捷键（见 src/main/index.ts）。
 *    否则菜单加速键和这里的监听会同时触发，一次按键撤销两步。
 */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTextField(event.target)) return;
      if (window.api) return; // Electron 由菜单负责

      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        void useHistoryStore.getState().undo();
        return;
      }

      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        void useHistoryStore.getState().redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
