import { useShallow } from 'zustand/react/shallow';
import { useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/Button';
import { exportSnapshot, importSnapshot } from '@/db/operations';
import { useHistoryStore } from '@/history/store';
import { useUiStore, type ThemeMode } from '@/store/ui';

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: '系统' },
  { value: 'light', label: '亮' },
  { value: 'dark', label: '暗' },
];

export function Toolbar({ boardId }: { boardId: string | null }) {
  const query = useUiStore((state) => state.query);
  const setQuery = useUiStore((state) => state.setQuery);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const onlyHighPriority = useUiStore((state) => state.onlyHighPriority);
  const toggleOnlyHighPriority = useUiStore((state) => state.toggleOnlyHighPriority);

  // 用 useShallow：一次取出多个值会返回新对象，浅比较可以避免无谓重渲染
  const { undo, redo, undoLabel, redoLabel } = useHistoryStore(
    useShallow((state) => ({
      undo: state.undo,
      redo: state.redo,
      undoLabel: state.past[state.past.length - 1]?.label ?? null,
      redoLabel: state.future[state.future.length - 1]?.label ?? null,
    })),
  );

  const [message, setMessage] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    const snapshot = await exportSnapshot();
    const result = await api.exportData(snapshot);
    setMessage(result.ok ? `已导出到：${result.data}` : `导出失败：${result.error}`);
  };

  const handleImport = async (): Promise<void> => {
    const result = await api.importData();
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    await importSnapshot(result.data);
    setMessage(`导入完成，共 ${result.data.cards.length} 张卡片`);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
      <label className="sr-only" htmlFor="search">
        搜索卡片
      </label>
      <input
        id="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索标题 / 备注 / 标签"
        className="h-8 w-56 rounded-md border border-line bg-surface-raised px-2 text-sm text-fg placeholder:text-fg-muted"
      />

      <label className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-sm">
        <input type="checkbox" checked={onlyHighPriority} onChange={toggleOnlyHighPriority} />
        只看高优先级
      </label>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void undo()}
          disabled={undoLabel === null}
          title={undoLabel ? `撤销：${undoLabel}` : '没有可撤销的操作'}
        >
          撤销
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void redo()}
          disabled={redoLabel === null}
          title={redoLabel ? `重做：${redoLabel}` : '没有可重做的操作'}
        >
          重做
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {message ? (
          <span role="status" className="max-w-72 truncate text-xs text-fg-muted">
            {message}
          </span>
        ) : null}

        <div className="flex overflow-hidden rounded-md border border-line">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              aria-pressed={theme === option.value}
              className={
                theme === option.value
                  ? 'h-8 bg-brand px-2 text-xs text-white'
                  : 'h-8 bg-surface-raised px-2 text-xs text-fg-muted hover:text-fg'
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button size="sm" variant="secondary" onClick={() => void handleExport()} disabled={!boardId}>
          导出
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void handleImport()} disabled={!boardId}>
          导入
        </Button>
      </div>
    </div>
  );
}
