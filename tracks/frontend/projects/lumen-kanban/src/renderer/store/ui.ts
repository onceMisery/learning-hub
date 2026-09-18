import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';

interface UiState {
  /** 搜索词：属于"一次性 UI 状态"，不持久化 */
  query: string;
  activeBoardId: string | null;
  theme: ThemeMode;
  onlyHighPriority: boolean;

  setQuery: (query: string) => void;
  setActiveBoard: (id: string) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleOnlyHighPriority: () => void;
}

/**
 * 这个 store 只放"客户端 UI 状态"。
 * 看板数据本身住在 Dexie 里 —— 不要把它抄一份进 store，
 * 否则会同时存在两份真相，同步成本极高（详见文档「状态分层」）。
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      query: '',
      activeBoardId: null,
      theme: 'system',
      onlyHighPriority: false,

      setQuery: (query) => set({ query }),
      setActiveBoard: (activeBoardId) => set({ activeBoardId }),
      setTheme: (theme) => set({ theme }),
      toggleOnlyHighPriority: () => set((state) => ({ onlyHighPriority: !state.onlyHighPriority })),
    }),
    {
      name: 'lumen-ui',
      version: 1,
      // 只持久化"下次打开还想保持"的项；搜索词不该被记住
      partialize: (state) => ({ activeBoardId: state.activeBoardId, theme: state.theme }),
    },
  ),
);
