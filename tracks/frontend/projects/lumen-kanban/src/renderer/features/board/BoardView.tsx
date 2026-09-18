import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Card, Column } from '@shared/types';
import { db } from '@/db/db';
import { matchesKeyword } from '@/lib/search';
import { useUiStore } from '@/store/ui';
import { ColumnView } from './ColumnView';

interface BoardViewProps {
  boardId: string;
  /** 变化一次就让第一列的输入框聚焦（用于响应菜单"新建卡片"） */
  focusToken: string | null;
  onOpenCard: (id: string) => void;
}

export function BoardView({ boardId, focusToken, onOpenCard }: BoardViewProps) {
  const columns = useLiveQuery<Column[], Column[]>(
    () => db.columns.where('boardId').equals(boardId).sortBy('order'),
    [boardId],
    [],
  );

  const cards = useLiveQuery<Card[], Card[]>(
    () => db.cards.where('boardId').equals(boardId).toArray(),
    [boardId],
    [],
  );

  const query = useUiStore((state) => state.query);
  const onlyHighPriority = useUiStore((state) => state.onlyHighPriority);

  const filtered = useMemo<Card[]>(
    () =>
      cards.filter(
        (card) => matchesKeyword(card, query) && (!onlyHighPriority || card.priority === 2),
      ),
    [cards, query, onlyHighPriority],
  );

  const firstColumnId = columns[0]?.id ?? null;

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {columns.map((column) => (
        <ColumnView
          key={column.id}
          boardId={boardId}
          column={column}
          cards={filtered}
          autoFocusToken={column.id === firstColumnId ? focusToken : null}
          onOpenCard={onOpenCard}
        />
      ))}
    </div>
  );
}
