import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useShell } from '@/components/Layout';
import { EmptyState } from '@/components/ui/States';
import { useProgress } from '@/lib/progress';
import { formatDate } from '@/lib/format';

export function ProgressPage() {
  const { index, setRight } = useShell();
  const { statusOf, recent, reset, counts } = useProgress();

  useEffect(() => {
    setRight(null);
  }, [setRight]);

  const perTrack = useMemo(() => {
    if (!index) return [];
    return index.tracks
      .map((track) => {
        const pages = track.sections.flatMap((section) => section.pages);
        const done = pages.filter((page) => statusOf(page.id) === 'done').length;
        return {
          track,
          total: pages.length,
          done,
          percent: pages.length === 0 ? 0 : Math.round((done / pages.length) * 100),
        };
      })
      .filter((item) => item.total > 0);
  }, [index, statusOf]);

  if (!index) return null;

  return (
    <div className="mx-auto max-w-[var(--content-max)]">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">我的进度</h1>
        <p className="mt-2.5 text-[14.5px] text-[var(--text-2)]">
          进度只保存在这台设备的浏览器里（localStorage），不会上传，也不会随仓库同步。
        </p>
      </header>

      <section className="mb-9">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="已完成" value={counts.done} />
          <Metric label="在读" value={counts.reading} />
          <Metric
            label="全站覆盖率"
            value={`${index.stats.pages === 0 ? 0 : Math.round((counts.done / index.stats.pages) * 100)}%`}
          />
        </div>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-[var(--text-3)]">
          各轨道进度
        </h2>
        {perTrack.length === 0 ? (
          <EmptyState title="还没有可追踪的轨道" description="已发布的轨道出现后即可在这里看到进度。" />
        ) : (
          <ul className="space-y-3">
            {perTrack.map(({ track, total, done, percent }) => (
              <li
                key={track.id}
                data-accent={track.accent}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/${track.id}`} className="truncate text-[14px] font-medium hover:underline">
                    {track.title}
                  </Link>
                  <span className="shrink-0 text-[12px] text-[var(--text-3)]">
                    {done}/{total} · {percent}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)]"
                    style={{ width: `${percent}%`, background: 'var(--accent)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-[var(--text-3)]">
          最近访问
        </h2>
        {recent.length === 0 ? (
          <EmptyState icon="clock" title="还没有阅读记录" description="打开任意一篇文档后，这里会留下足迹。" />
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
            {recent.slice(0, 12).map((item) => {
              const page = index.pages[item.id];
              if (!page) return null;
              return (
                <li key={item.id}>
                  <Link
                    to={page.route}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-[var(--surface-2)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {statusOf(page.id) === 'done' ? (
                        <span className="text-[var(--success)]" aria-label="已完成">
                          <Icon name="check" size={13} />
                        </span>
                      ) : (
                        <span className="text-[var(--text-3)]" aria-hidden="true">
                          <Icon name="book" size={13} />
                        </span>
                      )}
                      <span className="truncate text-[var(--text)]">{page.title}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-[var(--text-3)]">
                      {formatDate(new Date(item.at).toISOString()) ?? ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <button type="button" className="lh-btn" onClick={reset}>
          清空全部进度
        </button>
        <p className="mt-2 text-[12px] text-[var(--text-3)]">此操作不可撤销，请确认后再执行。</p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[11.5px] uppercase tracking-wider text-[var(--text-3)]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tracking-tight text-[var(--text)]">{value}</p>
    </div>
  );
}
