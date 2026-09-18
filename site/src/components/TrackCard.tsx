import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import type { TrackMeta } from '@/types/content';

interface TrackCardProps {
  track: TrackMeta;
  /** 已完成页面数 */
  doneCount: number;
}

const STATUS_LABEL: Record<TrackMeta['status'], string> = {
  active: '已发布',
  wip: '编写中',
  planned: '规划中',
};

/**
 * 轨道卡片：首页与轨道列表页共用。
 *
 * 信息按四层排布，层与层之间用固定间距拉开，避免扫读时糊成一片：
 *   1. 标题 + 状态        —— 最先被识别
 *   2. 一句话简介          —— 固定两行高度，保证同一行卡片的关键信息对齐
 *   3. 主题标签 + 资源事实  —— 标签用胶囊强调，篇数/工具链降为纯文本
 *   4. 进度 + 操作         —— 用一条分隔线独立成页脚，操作项单独一行
 */
export function TrackCard({ track, doneCount }: TrackCardProps) {
  const pageCount = track.sections.reduce((sum, section) => sum + section.pages.length, 0);
  const planned = track.status === 'planned';
  const percent = pageCount > 0 ? Math.round((doneCount / pageCount) * 100) : 0;

  return (
    <LinkOrBox
      planned={planned}
      trackId={track.id}
      accent={track.accent}
      className="group flex h-full flex-col rounded-[var(--radius-card)] border p-5 transition-[border-color,transform,background-color] duration-150 sm:p-6"
    >
      {/* 1. 标题与状态 */}
      <div className="flex items-start justify-between gap-4">
        <h3 className="min-w-0 text-[17px] font-semibold leading-snug tracking-tight text-[var(--text)]">
          {track.title}
        </h3>
        <span className="lh-chip lh-chip--status mt-0.5 shrink-0" data-status={track.status}>
          {STATUS_LABEL[track.status]}
        </span>
      </div>

      {/* 2. 简介：min-h 固定两行高度，让并排卡片的下方区块横向对齐 */}
      <p className="mt-3 line-clamp-2 min-h-[3.4em] text-[13.5px] leading-[1.7] text-[var(--text-2)]">
        {track.subtitle}
      </p>

      {/* 3a. 主题标签 */}
      {track.tags.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {track.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="lh-chip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {/* 3b. 资源事实：降级为纯文本，与上面的标签形成主次关系 */}
      {pageCount > 0 || track.toolchain ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] leading-none text-[var(--text-3)]">
          {pageCount > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="book" size={13} />
              {pageCount} 篇
            </span>
          ) : null}
          {track.toolchain ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="layers" size={13} />
              {track.toolchain}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 规划中轨道：列出暂定范围 */}
      {planned && track.outline.length > 0 ? (
        <ul className="mt-5 space-y-2 text-[12.5px] leading-[1.6] text-[var(--text-3)]">
          {track.outline.slice(0, 3).map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
              <span className="line-clamp-1">{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 4. 页脚：mt-auto 把整块推到卡片底部，保证同排卡片页脚基线一致 */}
      <div className="mt-auto pt-6">
        {pageCount > 0 ? (
          <div className="border-t border-[var(--border)] pt-5">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px] leading-none">
              <span className="text-[var(--text-3)]">学习进度</span>
              <span className="font-medium tabular-nums text-[var(--text-2)]">
                {doneCount}
                <span className="text-[var(--text-3)]">/{pageCount}</span>
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)]"
                style={{ width: `${percent}%`, background: 'var(--accent)' }}
              />
            </div>
          </div>
        ) : null}

        {/* 操作项独占一行，避免与进度信息挤在同一水平线上 */}
        <p className="mt-5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-2)] transition-colors duration-150 group-hover:text-[var(--accent)]">
          {planned ? (
            <>
              <Icon name="target" size={14} />
              规划中，可在 GitHub 上催更
            </>
          ) : (
            <>
              进入轨道
              <Icon name="arrow-right" size={14} />
            </>
          )}
        </p>
      </div>
    </LinkOrBox>
  );
}

interface LinkOrBoxProps {
  planned: boolean;
  trackId: string;
  accent: TrackMeta['accent'];
  className: string;
  children: ReactNode;
}

/** 已发布轨道渲染为链接，规划中轨道渲染为静态占位块（仅样式差异，交互语义不变） */
function LinkOrBox({ planned, trackId, accent, className, children }: LinkOrBoxProps) {
  const tone = planned
    ? 'border-dashed border-[var(--border)] bg-transparent'
    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)]';

  if (planned) {
    return (
      <div data-accent={accent} className={`${className} ${tone} cursor-default`} aria-disabled="true">
        {children}
      </div>
    );
  }

  return (
    <Link
      data-accent={accent}
      to={`/${trackId}`}
      className={`${className} ${tone}`}
    >
      {children}
    </Link>
  );
}
