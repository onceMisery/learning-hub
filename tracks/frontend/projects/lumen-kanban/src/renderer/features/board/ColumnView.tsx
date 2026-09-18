import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Card, Column, Priority } from '@shared/types';
import { db } from '@/db/db';
import { useHistoryStore } from '@/history/store';
import { newId } from '@/lib/id';
import { CardItem } from './CardItem';

interface ColumnViewProps {
  boardId: string;
  column: Column;
  /** 命中的卡片（已按 order 排序），由父组件统一过滤后传入 */
  cards: Card[];
  /** 值变化时聚焦本列的输入框；null 表示不需要聚焦 */
  autoFocusToken: string | null;
  onOpenCard: (id: string) => void;
}

export function ColumnView({
  boardId,
  column,
  cards,
  autoFocusToken,
  onOpenCard,
}: ColumnViewProps) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const execute = useHistoryStore((state) => state.execute);

  // 这里操作 DOM 是 effect 的正当用途（与外部系统同步），
  // 注意不需要 setState —— 用 setState 触发聚焦会产生多余的一次渲染。
  useEffect(() => {
    if (!autoFocusToken) return;
    inputRef.current?.focus();
  }, [autoFocusToken]);

  // 为什么用 useLiveQuery 而不是 useEffect + setState：
  // liveQuery 订阅的是数据库本身，任何地方（包括另一个窗口）写入都会自动刷新，
  // 不需要手动维护"改完记得 setCards" 这类易漏的逻辑。
  // 显式给出两个泛型参数：默认值 [] 会被推断成 never[]，
  // 结果类型变成 Card[] | never[]，之后调用 indexOf(card) 会因参数被求交成 never 而报错。
  const columnCards = useLiveQuery<Card[], Card[]>(
    () => db.cards.where('columnId').equals(column.id).sortBy('order'),
    [column.id],
    [],
  );

  const visible = columnCards.filter((card) => cards.some((item) => item.id === card.id));

  /** 新增卡片：构造完整 Card 对象再交给命令执行，
   *  这样"撤销"只需要删 id，不需要额外查库。 */
  const handleSubmit = async (): Promise<void> => {
    const value = title.trim();
    if (!value) return;

    const now = Date.now();
    const card: Card = {
      id: newId(),
      boardId,
      columnId: column.id,
      title: value,
      notes: '',
      tags: [],
      priority: 1 satisfies Priority,
      done: 0,
      order: columnCards.length,
      createdAt: now,
      updatedAt: now,
    };

    await execute({ kind: 'addCard', label: `新增「${value}」`, card });
    setTitle('');
  };

  /** 拖放到列的空白处：追加到末尾 */
  const handleDropOnColumn = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain');
    if (!cardId) return;

    const card = columnCards.find((item) => item.id === cardId);
    const from = card
      ? { columnId: column.id, index: columnCards.indexOf(card) }
      : { columnId: column.id, index: columnCards.length };

    void execute({
      kind: 'moveCard',
      label: '移动卡片',
      id: cardId,
      from,
      to: { columnId: column.id, index: columnCards.length },
    });
  };

  /** 拖放到某张卡片上：插入到它的位置 */
  const handleDropBefore = (event: DragEvent<HTMLDivElement>, target: Card): void => {
    const draggedId = event.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === target.id) return;

    const source = columnCards.find((item) => item.id === draggedId);
    const targetIndex = columnCards.findIndex((item) => item.id === target.id);

    void execute({
      kind: 'moveCard',
      label: '移动卡片',
      id: draggedId,
      from: source
        ? { columnId: column.id, index: columnCards.indexOf(source) }
        : { columnId: column.id, index: columnCards.length },
      to: { columnId: column.id, index: targetIndex < 0 ? columnCards.length : targetIndex },
    });
  };

  return (
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDropOnColumn}
      className="flex w-72 shrink-0 flex-col rounded-card bg-surface-sunken p-2"
    >
      <header className="flex items-center justify-between px-1 py-1 text-sm font-medium text-fg">
        <span>{column.name}</span>
        <span className="text-xs font-normal text-fg-muted">{visible.length}</span>
      </header>

      <ul className="mt-2 flex min-h-16 flex-1 flex-col gap-2">
        <AnimatePresence initial={false}>
          {visible.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              onOpen={() => onOpenCard(card.id)}
              onDropBefore={(event) => handleDropBefore(event, card)}
            />
          ))}
        </AnimatePresence>
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        className="mt-2"
      >
        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="添加卡片后回车"
          className="h-8 w-full rounded-md border border-line bg-surface-raised px-2 text-sm text-fg placeholder:text-fg-muted"
        />
      </form>
    </section>
  );
}
