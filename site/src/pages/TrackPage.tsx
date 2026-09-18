import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useShell } from '@/components/Layout';
import { ErrorState } from '@/components/ui/States';
import { useProgress } from '@/lib/progress';
import { formatDate } from '@/lib/format';

export function TrackPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const { index, setRight } = useShell();
  const { statusOf } = useProgress();

  useEffect(() => {
    setRight(null);
  }, [setRight]);

  const track = useMemo(
    () => index?.tracks.find((item) => item.id === trackId),
    [index, trackId],
  );

  if (!index) return null;

  if (!track) {
    return (
      <div className="mx-auto max-w-[var(--content-max)]">
        <ErrorState
          title="没有找到这条轨道"
          description={`tracks/ 下不存在 id 为「${trackId}」的轨道。`}
          action={
            <Link to="/" className="lh-btn">
              <Icon name="arrow-left" size={13} />
              返回首页
            </Link>
          }
        />
      </div>
    );
  }

  const verified = formatDate(track.verifiedAt);

  return (
    <div data-accent={track.accent} className="mx-auto max-w-[var(--content-max)]">
      <nav className="mb-4 flex items-center gap-1.5 text-[12.5px] text-[var(--text-3)]">
        <Link to="/" className="hover:text-[var(--text)]">
          首页
        </Link>
        <Icon name="chevron-right" size={12} />
        <span className="text-[var(--text-2)]">{track.title}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {track.title}
        </h1>
        {track.subtitle ? (
          <p className="mt-2.5 text-[14.5px] leading-[1.7] text-[var(--text-2)]">{track.subtitle}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {track.tags.map((tag) => (
            <span key={tag} className="lh-chip">
              {tag}
            </span>
          ))}
          {track.toolchain ? (
            <span className="lh-chip">
              <Icon name="layers" size={11} />
              {track.toolchain}
            </span>
          ) : null}
          {verified ? (
            <span className="lh-chip">
              <Icon name="clock" size={11} />
              {verified} 验证
            </span>
          ) : null}
        </div>
      </header>

      {track.status === 'planned' ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6">
          <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--text)]">
            <Icon name="target" size={14} />
            这条轨道还在规划中
          </p>
          {track.outline.length > 0 ? (
            <ul className="mt-3 space-y-2 text-[13.5px] text-[var(--text-2)]">
              {track.outline.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <a
            className="lh-btn mt-5"
            href={`${index.repoUrl}/issues/new?labels=track&title=${encodeURIComponent(`希望尽快开坑：${track.title}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            催更这条轨道
            <Icon name="external" size={12} />
          </a>
        </div>
      ) : (
        <div className="space-y-12">
          {track.sections.map((section) => {
            const done = section.pages.filter((page) => statusOf(page.id) === 'done').length;
            return (
              <section key={section.id}>
                {/* 分组标题与计数分列两端，标题下方留出呼吸空间 */}
                <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-3">
                  <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
                    {section.title}
                  </h2>
                  {section.pages.length > 0 ? (
                    <span className="text-[12px] text-[var(--text-3)]">
                      {done}/{section.pages.length} 已完成
                    </span>
                  ) : null}
                </div>

                <ul className="grid gap-3 sm:grid-cols-2">
                  {section.pages.map((page) => {
                    const finished = statusOf(page.id) === 'done';
                    return (
                      <li key={page.id} className="h-full">
                        <Link
                          to={page.route}
                          className="group flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors duration-150 hover:border-[var(--border-strong)]"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="text-[14.5px] font-medium leading-snug text-[var(--text)]">
                              {page.title}
                            </span>
                            {finished ? (
                              <span className="mt-0.5 shrink-0 text-[var(--success)]" aria-label="已完成">
                                <Icon name="check" size={13} />
                              </span>
                            ) : null}
                          </span>
                          {page.excerpt ? (
                            <span className="mt-2 line-clamp-2 text-[12.5px] leading-[1.65] text-[var(--text-3)]">
                              {page.excerpt}
                            </span>
                          ) : null}
                          {/* 元信息固定在卡片底部，同排卡片对齐 */}
                          <span className="mt-auto flex items-center gap-3 pt-4 text-[12px] text-[var(--text-3)]">
                            <span>{page.readingMinutes} 分钟</span>
                            {page.tags.slice(0, 2).map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
