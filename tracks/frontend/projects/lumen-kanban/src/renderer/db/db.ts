import Dexie, { type Table } from 'dexie';
import type { Board, Card, Column } from '@shared/types';

/**
 * Dexie 数据库定义。
 *
 * 索引字符串语法：
 *   第一个字段是主键
 *   普通字段          -> 普通索引
 *   [a+b]             -> 复合索引（支持按 boardId 过滤再按 columnId 排序）
 *   *tags             -> 多值索引（数组中的每个元素都能被检索）
 *
 * 注意：IndexedDB 不能索引 boolean，所以 Card.done 用 0/1。
 */
export class KanbanDB extends Dexie {
  boards!: Table<Board, string>;
  columns!: Table<Column, string>;
  cards!: Table<Card, string>;

  constructor() {
    super('lumen-kanban');

    this.version(1).stores({
      boards: 'id, name, createdAt',
      columns: 'id, boardId, order, [boardId+order]',
      cards: 'id, columnId, boardId, done, updatedAt, [boardId+columnId], *tags',
    });

    // v2：新增"优先级"字段。老数据必须回填，否则旧卡片 priority 为 undefined。
    this.version(2)
      .stores({
        cards: 'id, columnId, boardId, done, updatedAt, priority, [boardId+columnId], *tags',
      })
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((card: Card) => {
            if (typeof card.priority !== 'number') {
              card.priority = 1;
            }
          });
      });
  }
}

export const db = new KanbanDB();
