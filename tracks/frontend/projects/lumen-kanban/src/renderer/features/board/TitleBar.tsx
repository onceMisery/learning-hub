import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/Button';

/**
 * 自定义标题栏（配合主进程 frame: false）。
 * 拖拽区由 CSS 的 -webkit-app-region: drag 提供，按钮区域显式关闭拖拽，
 * 否则按钮点不动。
 */
export function TitleBar() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.appVersion().then((value) => {
      if (!cancelled) setVersion(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="titlebar-drag flex h-9 shrink-0 items-center justify-between border-b border-line bg-surface-raised px-3 text-xs text-fg-muted">
      <span>
        Lumen Kanban{version ? ` · v${version}` : ''}
      </span>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="最小化" onClick={() => void api.windowMinimize()}>
          -
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="最大化"
          onClick={() => void api.windowToggleMaximize()}
        >
          □
        </Button>
        <Button size="sm" variant="ghost" aria-label="关闭" onClick={() => void api.windowClose()}>
          ✕
        </Button>
      </div>
    </header>
  );
}
