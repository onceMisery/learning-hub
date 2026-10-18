import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useShell } from '@/components/Layout';
import { AGENT_LAB, labChapterUrl } from '@/lib/agent-lab';

/**
 * Agent 互动原理实验室。
 *
 * 左侧章节导航 + 右侧 iframe 承载自包含图解页（public/agent-lab/*.html）。
 * iframe 地址经 BASE_URL 拼接，Vercel（base=/）与 GitHub Pages（base=/learning-hub/）均可直达。
 */
export function AgentLabPage() {
  const { chapterId } = useParams<{ chapterId?: string }>();
  const { index, setRight } = useShell();

  useEffect(() => {
    setRight(null);
  }, [setRight]);

  const chapters = AGENT_LAB.chapters;
  const activeIndex = useMemo(() => {
    const found = chapters.findIndex((item) => item.id === chapterId);
    return found >= 0 ? found : 0;
  }, [chapterId, chapters]);
  const active = chapters[activeIndex];
  const prev = activeIndex > 0 ? chapters[activeIndex - 1] : null;
  const next = activeIndex < chapters.length - 1 ? chapters[activeIndex + 1] : null;

  const track = index?.tracks.find((item) => item.id === AGENT_LAB.trackId);

  return (
    <div data-accent={track?.accent ?? 'cyan'} className="mx-auto max-w-[1280px]">
      <nav className="mb-4 flex items-center gap-1.5 text-[12.5px] text-[var(--text-3)]">
        <Link to="/" className="hover:text-[var(--text)]">
          首页
        </Link>
        <Icon name="chevron-right" size={12} />
        {track ? (
          <Link to={`/${track.id}`} className="hover:text-[var(--text)]">
            {track.title}
          </Link>
        ) : null}
        <Icon name="chevron-right" size={12} />
        <span className="text-[var(--text-2)]">{AGENT_LAB.title}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {AGENT_LAB.title}
        </h1>
        <p className="mt-2.5 max-w-[720px] text-[14.5px] leading-[1.7] text-[var(--text-2)]">
          {AGENT_LAB.subtitle}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="lh-chip">
            <Icon name="layers" size={11} />
            {chapters.length} 章
          </span>
          <span className="lh-chip">自动运转 + 分步点击</span>
          <span className="lh-chip">每章配自测题</span>
          {track ? (
            <Link
              to={`/${track.id}`}
              className="lh-chip transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              <Icon name="arrow-left" size={11} />
              返回轨道教程
            </Link>
          ) : null}
        </div>
      </header>

      {/* 两列：左 228px 章节导航 + 右自适应正文。
          注意 minmax() 的 flex 值必须是 1fr（写成 1-fr 会让整条 grid-template-columns
          变成非法声明被丢弃，网格塌成单列，sticky 侧栏会通栏盖住正文）。 */}
      <div className="grid gap-6 xl:grid-cols-[228px_minmax(0,1fr)]">
        {/* 章节导航：桌面固定 228px，移动端横向滚动。
            min-w-0 必须有：grid 子项默认 min-width:auto，会被横滑条里
            7 张 220px 卡片的 min-content 撑开，导致整页横向溢出。 */}
        <aside className="min-w-0 xl:sticky xl:top-[calc(var(--header-h)+24px)] xl:self-start">
          <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">
            章节
          </p>
          <ol className="flex gap-2 overflow-x-auto pb-2 xl:flex-col xl:overflow-visible xl:pb-0">
            {chapters.map((chapter, i) => {
              const on = i === activeIndex;
              return (
                <li key={chapter.id} className="shrink-0 xl:shrink">
                  <Link
                    to={`${AGENT_LAB.route}/${chapter.id}`}
                    className={[
                      'flex h-full w-[220px] flex-col rounded-[var(--radius-md)] border p-3 transition-colors duration-100 xl:w-auto',
                      on
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
                    ].join(' ')}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="tabular-nums text-[11px] text-[var(--text-3)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[13.5px] font-medium leading-snug text-[var(--text)]">
                        {chapter.title}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 text-[11.5px] leading-[1.6] text-[var(--text-3)]">
                      {chapter.principle}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 hidden rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] p-3 text-[12px] leading-[1.7] text-[var(--text-3)] xl:block">
            <p className="mb-1 font-medium text-[var(--text-2)]">怎么看一页课</p>
            <p>动画默认自动运转；点步骤条圆点可逐帧定格。点部件卡片，图中对应部分会高亮。</p>
          </div>
        </aside>

        {/* 图解正文。用 div 而不是 main：外层 Layout 已经是 <main>，
            嵌套 main 违反 HTML 规范，会破坏读屏器的地标导航。 */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[12.5px] text-[var(--text-3)]">
              第 {activeIndex + 1} / {chapters.length} 章
            </span>
            <span className="text-[15px] font-medium text-[var(--text)]">{active.title}</span>
            <Link
              to={active.articleRoute}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-[var(--brand)] hover:underline"
            >
              阅读文章：{active.articleTitle}
              <Icon name="arrow-right" size={12} />
            </Link>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
            <iframe
              key={active.id}
              src={labChapterUrl(active.file)}
              title={`${active.title} · 动态图解`}
              className="block h-[calc(100dvh-260px)] min-h-[620px] w-full border-0 bg-white"
            />
          </div>

          <nav className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="章节翻页">
            {prev ? (
              <Link
                to={`${AGENT_LAB.route}/${prev.id}`}
                className="group rounded-[var(--radius-md)] border border-[var(--border)] p-3.5 transition-colors hover:border-[var(--border-strong)]"
              >
                <span className="flex items-center gap-1 text-[11.5px] text-[var(--text-3)]">
                  <Icon name="arrow-left" size={12} />
                  上一章
                </span>
                <span className="mt-1 block text-[13.5px] text-[var(--text)]">{prev.title}</span>
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
            {next ? (
              <Link
                to={`${AGENT_LAB.route}/${next.id}`}
                className="group rounded-[var(--radius-md)] border border-[var(--border)] p-3.5 text-right transition-colors hover:border-[var(--border-strong)] sm:col-start-2"
              >
                <span className="flex items-center justify-end gap-1 text-[11.5px] text-[var(--text-3)]">
                  下一章
                  <Icon name="arrow-right" size={12} />
                </span>
                <span className="mt-1 block text-[13.5px] text-[var(--text)]">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        </div>
      </div>
    </div>
  );
}
