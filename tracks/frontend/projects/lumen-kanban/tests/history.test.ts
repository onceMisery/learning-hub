import { beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { db } from '@/db/db';
import { moveCard } from '@/db/operations';
import { applyDo, applyUndo, type HistoryCommand } from '@/history/commands';
import { useHistoryStore } from '@/history/store';

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  id: 'card-1',
  boardId: 'board-1',
  columnId: 'col-a',
  title: '原始标题',
  notes: '',
  tags: [],
  priority: 1,
  done: 0,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const count = (): Promise<number> => db.cards.count();

describe('命令的正向与反向执行', () => {
  beforeEach(async () => {
    await db.cards.clear();
    await db.columns.clear();
    await db.boards.clear();
    useHistoryStore.getState().clear();
  });

  it('addCard：撤销等于删除', async () => {
    const command: HistoryCommand = { kind: 'addCard', label: '新增', card: makeCard() };

    await applyDo(command);
    expect(await count()).toBe(1);

    await applyUndo(command);
    expect(await count()).toBe(0);
  });

  it('removeCard：撤销能把整张卡片加回来', async () => {
    const card = makeCard({ id: 'card-9', title: '要删掉的' });
    await db.cards.add(card);

    const command: HistoryCommand = { kind: 'removeCard', label: '删除', card };
    await applyDo(command);
    expect(await count()).toBe(0);

    await applyUndo(command);
    expect(await db.cards.get('card-9')).toMatchObject({ title: '要删掉的' });
  });

  it('updateCard：撤销回到改动前的值', async () => {
    await db.cards.add(makeCard());

    const command: HistoryCommand = {
      kind: 'updateCard',
      label: '重命名',
      id: 'card-1',
      next: { title: '新标题' },
      prev: { title: '原始标题' },
    };

    await applyDo(command);
    expect((await db.cards.get('card-1'))?.title).toBe('新标题');

    await applyUndo(command);
    expect((await db.cards.get('card-1'))?.title).toBe('原始标题');
  });

  it('moveCard：撤销回到原来的列与位置', async () => {
    await db.cards.bulkAdd([
      makeCard({ id: 'a', columnId: 'col-a', order: 0 }),
      makeCard({ id: 'b', columnId: 'col-a', order: 1 }),
    ]);

    const command: HistoryCommand = {
      kind: 'moveCard',
      label: '移动',
      id: 'a',
      from: { columnId: 'col-a', index: 0 },
      to: { columnId: 'col-b', index: 0 },
    };

    await applyDo(command);
    expect((await db.cards.get('a'))?.columnId).toBe('col-b');

    await applyUndo(command);
    const restored = await db.cards.get('a');
    expect(restored?.columnId).toBe('col-a');
    expect(restored?.order).toBe(0);
  });

  it('移动不存在的卡片不会抛错（防御性）', async () => {
    await expect(moveCard('not-exists', 'col-a', 0)).resolves.toBeUndefined();
  });
});

describe('撤销栈的行为', () => {
  beforeEach(async () => {
    await db.cards.clear();
    await db.columns.clear();
    await db.boards.clear();
    useHistoryStore.getState().clear();
  });

  it('执行入 past，撤销入 future，重做再回 past', async () => {
    const store = useHistoryStore;
    const command: HistoryCommand = { kind: 'addCard', label: '新增', card: makeCard() };

    await store.getState().execute(command);
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().future).toHaveLength(0);

    await store.getState().undo();
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().future).toHaveLength(1);
    expect(await count()).toBe(0);

    await store.getState().redo();
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().future).toHaveLength(0);
    expect(await count()).toBe(1);
  });

  it('撤销到底后再调用 undo 是安全的空操作', async () => {
    await useHistoryStore.getState().undo();
    await useHistoryStore.getState().redo();
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it('新操作会清空重做栈（编辑器通用约定）', async () => {
    const store = useHistoryStore;

    await store.getState().execute({ kind: 'addCard', label: 'A', card: makeCard({ id: 'x' }) });
    await store.getState().undo();
    expect(store.getState().future).toHaveLength(1);

    await store.getState().execute({ kind: 'addCard', label: 'B', card: makeCard({ id: 'y' }) });
    expect(store.getState().future).toHaveLength(0);
    expect(store.getState().past).toHaveLength(1);
  });

  it('栈长度不超过上限，丢掉的是最旧的记录', async () => {
    const store = useHistoryStore;
    store.setState({ limit: 3 });

    for (const id of ['1', '2', '3', '4']) {
      await store.getState().execute({ kind: 'addCard', label: id, card: makeCard({ id }) });
    }

    expect(store.getState().past).toHaveLength(3);
    expect(store.getState().past[0]?.label).toBe('2');
  });
});
