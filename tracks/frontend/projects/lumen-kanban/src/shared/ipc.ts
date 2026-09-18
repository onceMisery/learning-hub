import { z } from 'zod';
import type { Snapshot } from './types';

/** IPC 通道名集中定义，避免主进程与渲染进程手写字面量不一致 */
export const IpcChannel = {
  AppVersion: 'app:version',
  ExportData: 'data:export',
  ImportData: 'data:import',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  MenuNewCard: 'menu:new-card',
  MenuUndo: 'menu:undo',
  MenuRedo: 'menu:redo',
} as const;

/**
 * 主进程收到的任何数据都不可信（渲染进程可能被 XSS 或被用户调试）。
 * 所以 IPC 入参一律用 zod 做运行时校验 —— 这是安全基线的一部分。
 */
const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const snapshotSchema = z.object({
  version: z.number().int().positive(),
  boards: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      createdAt: z.number(),
    }),
  ),
  columns: z.array(
    z.object({
      id: z.string().min(1),
      boardId: z.string().min(1),
      name: z.string(),
      order: z.number(),
    }),
  ),
  cards: z.array(
    z.object({
      id: z.string().min(1),
      boardId: z.string().min(1),
      columnId: z.string().min(1),
      title: z.string(),
      notes: z.string(),
      tags: z.array(z.string()),
      priority: prioritySchema,
      done: z.union([z.literal(0), z.literal(1)]),
      order: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
});

export type SnapshotInput = z.infer<typeof snapshotSchema> & Snapshot;

/** 渲染进程通过 window.api 访问的唯一接口 */
export interface Api {
  appVersion(): Promise<string>;
  exportData(snapshot: Snapshot): Promise<{ ok: true; data: string } | { ok: false; error: string }>;
  importData(): Promise<{ ok: true; data: Snapshot } | { ok: false; error: string }>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  /** 返回取消订阅函数 —— 组件卸载时必须调用，否则内存泄漏 */
  onMenuNewCard(callback: () => void): () => void;
  /** 菜单"撤销"（CmdOrCtrl+Z） */
  onMenuUndo(callback: () => void): () => void;
  /** 菜单"重做"（CmdOrCtrl+Shift+Z） */
  onMenuRedo(callback: () => void): () => void;
}

declare global {
  interface Window {
    api?: Api;
  }
}
