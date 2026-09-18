import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { api } from '@/api';
import { ensureSeed } from '@/db/operations';
import { useHistoryShortcuts } from '@/hooks/useHistoryShortcuts';
import { useHistoryStore } from '@/history/store';
import { newId } from '@/lib/id';
import { useThemeEffect } from '@/hooks/useTheme';
import { BoardView } from '@/features/board/BoardView';
import { CardDialog } from '@/features/board/CardDialog';
import { TitleBar } from '@/features/board/TitleBar';
import { Toolbar } from '@/features/board/Toolbar';

export default function App() {
  useThemeEffect();

  const [boardId, setBoardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureSeed().then((id) => {
      if (!cancelled) setBoardId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // onMenuNewCard 返回取消函数，直接在 useEffect 里 return 即可自动清理
  useEffect(
    () =>
      api.onMenuNewCard(() => {
        // 用"新 token"通知下游聚焦，而不是 setState 一个计数器再让子组件去 effect 里同步
        setFocusToken(newId());
      }),
    [],
  );

  // 撤销/重做：Electron 由菜单快捷键触发，浏览器由 useHistoryShortcuts 监听
  useEffect(() => api.onMenuUndo(() => void useHistoryStore.getState().undo()), []);
  useEffect(() => api.onMenuRedo(() => void useHistoryStore.getState().redo()), []);
  useHistoryShortcuts();

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <TitleBar />
        <Toolbar boardId={boardId} />

        <main className="min-h-0 flex-1">
          {boardId ? (
            <BoardView boardId={boardId} focusToken={focusToken} onOpenCard={setEditingCardId} />
          ) : (
            <p className="p-4 text-sm text-fg-muted">正在初始化本地数据库…</p>
          )}
        </main>
      </div>

      <AnimatePresence>
        {editingCardId ? (
          <CardDialog cardId={editingCardId} onClose={() => setEditingCardId(null)} />
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
