import type { Card, Priority, Snapshot } from '@shared/types';
import { db } from './db';
import { newId } from '@/lib/id';
import { matchesKeyword } from '@/lib/search';

export const SNAPSHOT_VERSION = 2;

const now = (): number => Date.now();

/** 首次启动时写入一份示例数据，返回默认看板 id */
export async function ensureSeed(): Promise<string> {
  const existing = await db.boards.orderBy('createdAt').first();
  if (existing) return existing.id;

  const boardId = newId();
  const columnNames = ['待办', '进行中', '已完成'];

  await db.transaction('rw', db.boards, db.columns, db.cards, async () => {
    await db.boards.add({ id: boardId, name: '我的第一个看板', createdAt: now() });

    const columns = columnNames.map((name, index) => ({
      id: newId(),
      boardId,
      name,
      order: index,
    }));
    await db.columns.bulkAdd(columns);

    const sample: Array<Pick<Card, 'columnId' | 'title' | 'priority'>> = [
      { columnId: columns[0]!.id, title: '读 Vite 8 迁移指南', priority: 2 },
      { columnId: columns[0]!.id, title: '给 IPC 层补 zod 校验', priority: 1 },
      { columnId: columns[1]!.id, title: '实现卡片拖拽排序', priority: 2 },
      { columnId: columns[2]!.id, title: '搭好 Vite + TS 7 脚手架', priority: 0 },
    ];

    await db.cards.bulkAdd(
      sample.map((item, index) => ({
        id: newId(),
        boardId,
        columnId: item.columnId,
        title: item.title,
        notes: '',
        tags: [],
        priority: item.priority,
        done: item.columnId === columns[2]!.id ? 1 : 0,
        order: index,
        createdAt: now(),
        updatedAt: now(),
      })),
    );
  });

  return boardId;
}

export interface NewCardInput {
  boardId: string;
  columnId: string;
  title: string;
  priority?: Priority;
}

export async function addCard(input: NewCardInput): Promise<string> {
  const id = newId();
  const siblings = await db.cards.where('columnId').equals(input.columnId).count();

  await db.cards.add({
    id,
    boardId: input.boardId,
    columnId: input.columnId,
    title: input.title,
    notes: '',
    tags: [],
    priority: input.priority ?? 1,
    done: 0,
    order: siblings,
    createdAt: now(),
    updatedAt: now(),
  });

  return id;
}

export type CardPatch = Partial<Pick<Card, 'title' | 'notes' | 'tags' | 'priority' | 'done'>>;

export async function updateCard(id: string, patch: CardPatch): Promise<void> {
  await db.cards.update(id, { ...patch, updatedAt: now() });
}

export async function removeCard(id: string): Promise<void> {
  await db.cards.delete(id);
}

/**
 * 移动卡片到目标列的指定位置。
 *
 * 为什么整个函数包在一个事务里：要重排目标列所有卡片的 order，
 * 中途失败必须整体回滚，否则会出现两张卡片 order 相同、顺序随机漂移。
 */
export async function moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(cardId);
    if (!card) return;

    const target = await db.cards.where('columnId').equals(toColumnId).sortBy('order');
    const rest = target.filter((item) => item.id !== cardId);
    const insertAt = Math.max(0, Math.min(toIndex, rest.length));
    rest.splice(insertAt, 0, { ...card, columnId: toColumnId });

    const timestamp = now();
    await db.cards.bulkPut(rest.map((item, index) => ({ ...item, order: index, updatedAt: timestamp })));
  });
}

/**
 * 按关键字过滤卡片。
 *
 * 适用边界：这是全量读取后在内存里过滤（O(n)）。
 * 几百到几千条完全够用；上万条应改成倒排索引或 Web Worker 内建索引，
 * 详见文档「搜索的三条路线与取舍」。
 */
export async function searchCards(boardId: string, query: string): Promise<Card[]> {
  const all = await db.cards.where('boardId').equals(boardId).toArray();
  return all.filter((card) => matchesKeyword(card, query));
}

export async function exportSnapshot(): Promise<Snapshot> {
  const [boards, columns, cards] = await Promise.all([
    db.boards.toArray(),
    db.columns.toArray(),
    db.cards.toArray(),
  ]);
  return { version: SNAPSHOT_VERSION, boards, columns, cards };
}

/** 导入快照：整库替换。为什么不用增量合并：本地数据本来就是"这一份"，替换语义最不容易出错。 */
export async function importSnapshot(snapshot: Snapshot): Promise<void> {
  await db.transaction('rw', db.boards, db.columns, db.cards, async () => {
    await Promise.all([db.boards.clear(), db.columns.clear(), db.cards.clear()]);
    await db.boards.bulkPut(snapshot.boards);
    await db.columns.bulkPut(snapshot.columns);
    await db.cards.bulkPut(snapshot.cards);
  });
}
