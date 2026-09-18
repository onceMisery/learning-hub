import type { Card } from '@shared/types';
import type { CardPatch } from '@/db/operations';
import { moveCard } from '@/db/operations';
import { db } from '@/db/db';

export interface Position {
  columnId: string;
  index: number;
}

/**
 * 命令（Command）模式：把一次操作抽象成"数据"，而不是闭包。
 *
 * 为什么不用 `{ undo: () => {}, redo: () => {} }` 闭包：
 * 1. 数据是纯的，可以在测试里直接断言，不需要跑一遍数据库
 * 2. 可以序列化（将来要做"操作日志/协同/持久化历史"时不用重写）
 * 3. 组件里只负责"记录发生了什么"，不关心"怎么反向执行"
 */
export type HistoryCommand =
  | { kind: 'addCard'; label: string; card: Card }
  | { kind: 'removeCard'; label: string; card: Card }
  | { kind: 'updateCard'; label: string; id: string; next: CardPatch; prev: CardPatch }
  | { kind: 'moveCard'; label: string; id: string; from: Position; to: Position };

const touch = (): number => Date.now();

/** 正向执行 */
export async function applyDo(command: HistoryCommand): Promise<void> {
  switch (command.kind) {
    case 'addCard':
      await db.cards.add(command.card);
      return;

    case 'removeCard':
      await db.cards.delete(command.card.id);
      return;

    case 'updateCard':
      await db.cards.update(command.id, { ...command.next, updatedAt: touch() });
      return;

    case 'moveCard':
      await moveCard(command.id, command.to.columnId, command.to.index);
      return;
  }
}

/** 反向执行 */
export async function applyUndo(command: HistoryCommand): Promise<void> {
  switch (command.kind) {
    case 'addCard':
      await db.cards.delete(command.card.id);
      return;

    case 'removeCard':
      // 直接 add 回原对象：id 与 order 都还在，位置基本能复原
      await db.cards.add(command.card);
      return;

    case 'updateCard':
      await db.cards.update(command.id, { ...command.prev, updatedAt: touch() });
      return;

    case 'moveCard':
      await moveCard(command.id, command.from.columnId, command.from.index);
      return;
  }
}
