import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { loadSearchDocs } from '@/lib/content';
import { highlightParts, search, type SearchHit } from '@/lib/search';
import type { ContentIndex, SearchDoc } from '@/types/content';
import { Spinner } from './ui/States';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  index: ContentIndex | null;
}

const MAX_RESULTS = 24;

/**
 * 全文搜索面板。
 *
 * 搜索语料较大，首次打开时才拉取；键盘全程可用：
 * ↑↓ 选择、Enter 打开、Esc 关闭。
 */
export function SearchDialog({ open, onClose, index }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<SearchDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // 打开时聚焦；关闭时清空状态，避免下次打开残留旧结果
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
    setQuery('');
    setActive(0);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open || docs) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadSearchDocs(controller.signal)
      .then((value) => setDocs(value))
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, docs]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!docs || query.trim().length === 0) return [];
    return search(docs, query, { limit: MAX_RESULTS });
  }, [docs, query]);

  useEffect(() => setActive(0), [query]);

  const trackTitle = useCallback(
    (trackId: string) => index?.tracks.find((t) => t.id === trackId)?.title ?? trackId,
    [index],
  );

  const go = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      onClose();
      navigate(hit.doc.route);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((v) => Math.min(v + 1, hits.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((v) => Math.max(v - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        go(hits[active]);
      }
    },
    [active, go, hits, onClose],
  );

  // 键盘移动时把选中项滚进可视区
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.215, 0.61, 0.355, 1] }}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="站内搜索"
            className="relative w-full max-w-[620px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow)]"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: 0.18, ease: [0.215, 0.61, 0.355, 1] }}
          >
            {/* 聚焦反馈由整行承担：底部边框与图标转为品牌色。
                输入框本身是通栏无边框的，套一圈 outline 会在浮层里显得突兀。 */}
            <div className="group flex items-center gap-2.5 border-b border-[var(--border)] px-4 transition-colors duration-150 focus-within:border-[var(--brand)]">
              <span className="text-[var(--text-3)] transition-colors duration-150 group-focus-within:text-[var(--brand)]">
                <Icon name="search" size={16} />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="搜索教程、实战项目与源码…"
                className="h-12 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
                aria-label="搜索关键词"
              />
              <button type="button" className="lh-btn !h-7 !px-2 !text-[11px]" onClick={onClose}>
                Esc
              </button>
            </div>

            <div ref={listRef} className="max-h-[min(60vh,460px)] overflow-y-auto p-2">
              {loading ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-3)]">
                  <Spinner label="正在准备搜索索引" />
                  正在准备搜索索引
                </p>
              ) : error ? (
                <p className="py-10 text-center text-sm text-[var(--danger)]">{error}</p>
              ) : query.trim().length === 0 ? (
                <p className="py-10 text-center text-sm text-[var(--text-3)]">
                  输入关键词开始搜索，支持中英文混合
                </p>
              ) : hits.length === 0 ? (
                <p className="py-10 text-center text-sm text-[var(--text-3)]">
                  没有匹配「{query}」的内容，换个说法试试
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {hits.map((hit, index) => (
                    <li key={hit.doc.id}>
                      <button
                        type="button"
                        data-index={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit)}
                        className={`w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors duration-100 ${
                          index === active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-[11.5px] text-[var(--text-3)]">
                          <span>{trackTitle(hit.doc.trackId)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{hit.doc.sectionTitle}</span>
                        </span>
                        <span className="mt-0.5 block text-[14.5px] font-medium text-[var(--text)]">
                          {highlightParts(hit.doc.title, query).map((part, i) =>
                            part.hit ? (
                              <mark key={i} className="rounded-[3px] bg-[var(--mark)] text-inherit">
                                {part.text}
                              </mark>
                            ) : (
                              <span key={i}>{part.text}</span>
                            ),
                          )}
                        </span>
                        {hit.snippet ? (
                          <span className="mt-1 block line-clamp-2 text-[12.5px] leading-[1.6] text-[var(--text-2)]">
                            {highlightParts(hit.snippet, query).map((part, i) =>
                              part.hit ? (
                                <mark key={i} className="rounded-[3px] bg-[var(--mark)] text-inherit">
                                  {part.text}
                                </mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              ),
                            )}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[11.5px] text-[var(--text-3)]">
              <span className="flex items-center gap-3">
                <span>↑↓ 选择</span>
                <span>Enter 打开</span>
              </span>
              <span>{hits.length > 0 ? `${hits.length} 条结果` : ''}</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
