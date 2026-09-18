import { useCallback, useState } from 'react';

export type SidebarMode = 'expanded' | 'collapsed';

const STORAGE_KEY = 'lh-sidebar';

function readInitialMode(): SidebarMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    // 隐私模式下 localStorage 可能不可读，按默认展开处理
    return 'expanded';
  }
}

/**
 * 桌面端侧边导航的收起状态。
 *
 * 阅读长文时 272px 的固定侧栏是纯损失，所以允许整列收起让正文吃掉这块宽度。
 * 状态存在 localStorage 里：这是「读文档的习惯」，不该每次刷新都重置。
 * 窄屏下侧栏本来就是抽屉（由 Layout 的 drawerOpen 管），这里只管 lg 以上。
 */
export function useSidebar(): { mode: SidebarMode; collapsed: boolean; toggle: () => void } {
  const [mode, setMode] = useState<SidebarMode>(readInitialMode);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: SidebarMode = prev === 'collapsed' ? 'expanded' : 'collapsed';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 写不进去也不影响本次会话的使用
      }
      return next;
    });
  }, []);

  return { mode, collapsed: mode === 'collapsed', toggle };
}
