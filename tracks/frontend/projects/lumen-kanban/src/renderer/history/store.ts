import { create } from 'zustand';
import { applyDo, applyUndo, type HistoryCommand } from './commands';

/**
 * 撤销栈的上限。
 * 为什么不无限存：每条命令都带着一份卡片快照，几百条之后内存与"撤销到哪了"的心智负担都不划算。
 * 50 条对单机应用足够（Linear/Figma 这类是 100+，但它们的命令更细粒度）。
 */
const DEFAULT_LIMIT = 50;

interface HistoryState {
  past: HistoryCommand[];
  future: HistoryCommand[];
  limit: number;

  /** 执行一条命令：先落库，再入栈 */
  execute: (command: HistoryCommand) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
}

/**
 * 为什么历史不持久化：
 * 撤销栈描述的是"本次会话里做过什么"，重开应用后数据可能已被别处改动，
 * 拿旧的反向操作去改新数据会写坏。所以不套 persist 中间件。
 */
export const useHistoryStore = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],
  limit: DEFAULT_LIMIT,

  execute: async (command) => {
    await applyDo(command);
    set((state) => ({
      past: [...state.past, command].slice(-state.limit),
      // 新操作产生后，原来的"重做"分支就失效了（这是所有编辑器的通用约定）
      future: [],
    }));
  },

  undo: async () => {
    const { past } = get();
    const command = past[past.length - 1];
    if (!command) return;

    await applyUndo(command);
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [...state.future, command],
    }));
  },

  redo: async () => {
    const { future } = get();
    const command = future[future.length - 1];
    if (!command) return;

    await applyDo(command);
    set((state) => ({
      past: [...state.past, command],
      future: state.future.slice(0, -1),
    }));
  },

  clear: () => set({ past: [], future: [] }),
}));

export const selectCanUndo = (state: HistoryState): boolean => state.past.length > 0;
export const selectCanRedo = (state: HistoryState): boolean => state.future.length > 0;
