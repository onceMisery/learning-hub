import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';
import { cn } from '@/lib/format';
import type { ContentIndex, TrackMeta } from '@/types/content';

interface SidebarProps {
  index: ContentIndex;
  /** 当前所在轨道（文档页才有） */
  activeTrackId?: string;
  activePageId?: string;
  /** 已完成页面 id 集合，用于打勾 */
  doneIds?: Set<string>;
  onNavigate?: () => void;
}

/**
 * 侧边导航。
 *
 * 始终展示全部轨道，保证任何位置都能一键跳转；
 * 当前轨道默认展开，其余折叠，避免在长列表里迷失。
 */
export function Sidebar({ index, activeTrackId, activePageId, doneIds, onNavigate }: SidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 路由变化时展开当前轨道；用户手动折叠的状态也保留
  useEffect(() => {
    if (activeTrackId) setExpanded((prev) => ({ ...prev, [activeTrackId]: true }));
  }, [activeTrackId]);

  const tracks = useMemo(
    () => index.tracks.filter((track) => track.sections.length > 0 || track.status === 'planned'),
    [index.tracks],
  );

  return (
    <nav aria-label="文档导航" className="flex flex-col gap-1 pb-8 text-[13.5px]">
      {tracks.map((track) => (
        <TrackGroup
          key={track.id}
          track={track}
          open={expanded[track.id] ?? track.id === activeTrackId}
          onToggle={() =>
            setExpanded((prev) => ({ ...prev, [track.id]: !(prev[track.id] ?? track.id === activeTrackId) }))
          }
          activePageId={activePageId}
          doneIds={doneIds}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

interface TrackGroupProps {
  track: TrackMeta;
  open: boolean;
  onToggle: () => void;
  activePageId?: string;
  doneIds?: Set<string>;
  onNavigate?: () => void;
}

function TrackGroup({ track, open, onToggle, activePageId, doneIds, onNavigate }: TrackGroupProps) {
  const isActiveTrack = activePageId?.startsWith(`${track.id}/`) ?? false;
  const pageCount = track.sections.reduce((sum, section) => sum + section.pages.length, 0);
  const doneCount = track.sections.reduce(
    (sum, section) => sum + section.pages.filter((page) => doneIds?.has(page.id)).length,
    0,
  );

  return (
    <div data-accent={track.accent}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-colors duration-100',
          isActiveTrack ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]',
        )}
      >
        <span
          className={cn('transition-transform duration-200 ease-[var(--ease-out)]', open && 'rotate-90')}
          style={{ color: 'var(--accent)' }}
        >
          <Icon name="chevron-right" size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[var(--text)]">{track.title}</span>
          {pageCount > 0 ? (
            <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">
              {doneCount > 0 ? `${doneCount}/${pageCount} 已完成` : `${pageCount} 篇`}
            </span>
          ) : null}
        </span>
        {track.status === 'planned' ? (
          <span className="lh-chip lh-chip--status !text-[10.5px]" data-status="planned" title="规划中">
            规划中
          </span>
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[11px] mt-1 border-l border-[var(--border)] pl-2.5">
              {track.status === 'planned' ? (
                <p className="px-2 py-2 text-[12.5px] leading-[1.7] text-[var(--text-3)]">
                  这条轨道还在规划中。
                  {track.outline.length > 0 ? (
                    <>
                      <br />
                      暂定覆盖：{track.outline.slice(0, 2).join('、')}…
                    </>
                  ) : null}
                </p>
              ) : null}

              {track.sections.map((section) => (
                <div key={section.id} className="mb-2">
                  <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">
                    {section.title}
                  </p>
                  {section.pages.map((page) => {
                    const active = page.id === activePageId;
                    const done = doneIds?.has(page.id) ?? false;
                    return (
                      <NavLink
                        key={page.id}
                        to={page.route}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-start gap-1.5 rounded-[var(--radius-sm)] px-2 py-[5px] text-[13px] leading-snug transition-colors duration-100',
                          active
                            ? 'bg-[var(--accent-soft)] font-medium text-[var(--text)]'
                            : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                        )}
                      >
                        <span
                          className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                          style={{
                            background: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--border-strong)',
                          }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">{page.title}</span>
                        {done ? (
                          <span className="mt-[3px] text-[var(--success)]" aria-label="已完成">
                            <Icon name="check" size={11} />
                          </span>
                        ) : null}
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
