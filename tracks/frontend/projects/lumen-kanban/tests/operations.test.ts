import { beforeEach, describe, expect, it } from 'vitest';
import type { Column } from '@shared/types';
import { db } from '@/db/db';
import { addCard, ensureSeed, moveCard, searchCards } from '@/db/operations';
import { matchesKeyword } from '@/lib/search';

async function reset(): Promise<void> {
  await db.cards.clear();
  await db.columns.clear();
  await db.boards.clear();
}

async function makeColumn(boardId: string, name: string, order: number): Promise<Column> {
  const column: Column = { id: `col-${name}`, boardId, name, order };
  await db.columns.add(column);
  return column;
}

describe('看板数据层', () => {
  beforeEach(reset);

  it('ensureSeed 只会初始化一次', async () => {
    const first = await ensureSeed();
    const second = await ensureSeed();

    expect(second).toBe(first);
    expect(await db.boards.count()).toBe(1);
    expect(await db.columns.count()).toBe(3);
  });

  it('addCard 按插入顺序追加 order', async () => {
    const boardId = 'board-1';
    const column = await makeColumn(boardId, '待办', 0);

    await addCard({ boardId, columnId: column.id, title: 'A' });
    await addCard({ boardId, columnId: column.id, title: 'B' });

    const cards = await db.cards.where('columnId').equals(column.id).sortBy('order');
    expect(cards.map((card) => card.title)).toEqual(['A', 'B']);
    expect(cards.map((card) => card.order)).toEqual([0, 1]);
  });

  it('moveCard 跨列移动并重排 order，且不会产生重复序号', async () => {
    const boardId = 'board-1';
    const todo = await makeColumn(boardId, '待办', 0);
    const doing = await makeColumn(boardId, '进行中', 1);

    const first = await addCard({ boardId, columnId: todo.id, title: 'A' });
    const second = await addCard({ boardId, columnId: todo.id, title: 'B' });
    const third = await addCard({ boardId, columnId: doing.id, title: 'C' });

    await moveCard(second, doing.id, 0);

    const doingCards = await db.cards.where('columnId').equals(doing.id).sortBy('order');
    expect(doingCards.map((card) => card.id)).toEqual([second, third]);
    expect(new Set(doingCards.map((card) => card.order)).size).toBe(doingCards.length);

    const todoCards = await db.cards.where('columnId').equals(todo.id).sortBy('order');
    expect(todoCards.map((card) => card.id)).toEqual([first]);
  });

  it('moveCard 遇到不存在的卡片时保持数据不变', async () => {
    const boardId = 'board-1';
    const column = await makeColumn(boardId, '待办', 0);
    await addCard({ boardId, columnId: column.id, title: 'A' });

    await moveCard('not-exists', column.id, 0);

    expect(await db.cards.count()).toBe(1);
  });

  it('searchCards 能命中标题、备注与标签', async () => {
    const boardId = 'board-1';
    const column = await makeColumn(boardId, '待办', 0);
    await addCard({ boardId, columnId: column.id, title: '修复登录问题' });

    const id = await addCard({ boardId, columnId: column.id, title: '写周报' });
    await db.cards.update(id, { notes: '包含本周进展', tags: ['文档'] });

    expect((await searchCards(boardId, '登录')).length).toBe(1);
    expect((await searchCards(boardId, '周进展')).length).toBe(1);
    expect((await searchCards(boardId, '文档')).length).toBe(1);
    expect((await searchCards(boardId, '不存在的词')).length).toBe(0);
    expect((await searchCards(boardId, '  ')).length).toBe(2);
  });

  it('matchesKeyword 空关键字返回全部', async () => {
    const boardId = 'board-1';
    const column = await makeColumn(boardId, '待办', 0);
    const id = await addCard({ boardId, columnId: column.id, title: '任意' });
    const card = await db.cards.get(id);

    expect(card).toBeDefined();
    expect(matchesKeyword(card!, '')).toBe(true);
    expect(matchesKeyword(card!, 'zzz')).toBe(false);
  });
});
