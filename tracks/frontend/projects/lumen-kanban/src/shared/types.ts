/**
 * 全应用共享的数据模型。
 * 这些类型同时被渲染进程、主进程、预加载脚本引用，是跨进程契约的唯一真源。
 */

export type Priority = 0 | 1 | 2;

export interface Board {
  id: string;
  name: string;
  createdAt: number;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  order: number;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  notes: string;
  tags: string[];
  /** 0=低 1=中 2=高 */
  priority: Priority;
  /** IndexedDB 无法索引 boolean，用 0/1 代替 */
  done: 0 | 1;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Snapshot {
  version: number;
  boards: Board[];
  columns: Column[];
  cards: Card[];
}

/**
 * 统一的成功/失败返回类型。
 * 为什么不用抛异常：IPC 边界上异常会丢失类型信息，且渲染进程拿不到堆栈。
 */
export type Result<T, E = string> = { ok: true; data: T } | { ok: false; error: E };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <E = string>(error: E): Result<never, E> => ({ ok: false, error });
