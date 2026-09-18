import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { LangTabItem } from '@/types/content';
import { Icon } from '../Icon';

interface LangTabsProps {
  /** 可选标题，说明这组对照在比什么 */
  title?: string | null;
  items: LangTabItem[];
}

/**
 * 多语言语法对照块。
 *
 * 同一段逻辑的多种语言实现放在一个组件里用标签切换，而不是在正文里顺序堆叠，
 * 这样读者可以"就近对照"，页面长度也不会被五段代码撑爆。
 *
 * 高亮在构建期由 Shiki 完成（与普通代码块同一套双主题变量），
 * 这里只负责切换、复制与无障碍键盘操作。
 */
export function LangTabs({ title, items }: LangTabsProps) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const current = items[active];

  const copy = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非安全上下文（http）下剪贴板不可用，保持原状即可
      setCopied(false);
    }
  }, [current]);

  /** 键盘导航遵循 WAI-ARIA tabs 模式：左右箭头切换，Home/End 跳首尾 */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = items.length - 1;
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null) return;
      event.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    },
    [items.length],
  );

  if (items.length === 0) return null;

  return (
    <div className="lh-langtabs">
      {title ? <p className="lh-langtabs-title">{title}</p> : null}
      <div className="lh-langtabs-bar">
        <div className="lh-langtabs-tablist" role="tablist" aria-label={title || '多语言语法对照'}>
          {items.map((item, index) => (
            <button
              key={`${item.lang}-${index}`}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`${baseId}-tab-${index}`}
              type="button"
              role="tab"
              className="lh-langtabs-tab"
              data-active={index === active}
              aria-selected={index === active}
              aria-controls={`${baseId}-panel-${index}`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="lh-btn"
          style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
          onClick={copy}
          aria-label="复制当前语言代码"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {current ? (
        <div
          id={`${baseId}-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active}`}
          className="lh-langtabs-panel"
          tabIndex={0}
          /* Shiki 输出已在构建期完成 HTML 转义，且内容来自本仓库受信任的 Markdown */
          dangerouslySetInnerHTML={{ __html: current.html }}
        />
      ) : null}
    </div>
  );
}
