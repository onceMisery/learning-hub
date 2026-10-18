import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useShell } from '@/components/Layout';
import { labChapterUrl, type LabConfig } from '@/lib/lab';

/**
 * Fullscreen API 兜底。
 *
 * Safari（含 iOS）至今只有 webkit 前缀版本，Standard 版在部分环境里干脆不存在。
 * 这里统一做能力探测：拿不到就静默降级成「按钮点了没反应」，而不是抛异常打断渲染。
 */
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

function currentFullscreen(): Element | null {
  const doc = document as FsDocument;
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

function enterFullscreen(el: HTMLElement): void {
  const target = el as FsElement;
  // 用户手势外发起、iframe 沙箱限制等场景浏览器会直接 reject，吞掉即可
  if (typeof el.requestFullscreen === 'function') {
    void el.requestFullscreen().catch(() => undefined);
  } else if (typeof target.webkitRequestFullscreen === 'function') {
    void target.webkitRequestFullscreen().catch(() => undefined);
  }
}

function exitFullscreen(): void {
  const doc = document as FsDocument;
  if (typeof doc.exitFullscreen === 'function') {
    void doc.exitFullscreen().catch(() => undefined);
  } else if (typeof doc.webkitExitFullscreen === 'function') {
    void doc.webkitExitFullscreen().catch(() => undefined);
  }
}

/**
 * 图解区的三种呈现尺寸。
 *
 * - normal：嵌在页面里（顶栏 + 侧边导航都在）；
 * - page：网页全屏 —— 覆盖层铺满浏览器视口，顶栏与侧栏让位，浏览器边框还在；
 * - browser：浏览器全屏 —— 走 Fullscreen API，连浏览器边框一起隐去。
 *
 * 两种全屏共用同一个 portal 覆盖层：覆盖层挂在 document.body 末尾，
 * 不受任何祖先层叠上下文 / transform 影响，且全站任何时刻最多只有一份
 * 工具条 + 一个 iframe —— 「两个表头」这类重复在结构上不可能出现。
 */
type ExpandMode = 'normal' | 'page' | 'browser';

/**
 * 互动原理实验室的通用外壳。
 *
 * 左侧章节导航 + 右侧 iframe 承载自包含图解页（public/<baseDir>/*.html）。
 * iframe 地址经 BASE_URL 拼接，Vercel（base=/）与 GitHub Pages（base=/learning-hub/）均可直达。
 */
export function LabPage({ lab }: { lab: LabConfig }) {
  const { chapterId } = useParams<{ chapterId?: string }>();
  const { index, setRight } = useShell();

  useEffect(() => {
    setRight(null);
  }, [setRight]);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ExpandMode>('normal');

  // 浏览器全屏的状态以浏览器为准（Esc、F11、地址栏退出都不经过我们的按钮），
  // 只监听 fullscreenchange 才不会出现「按了 Esc 但按钮还写着退出全屏」。
  // 退出时只把 browser → normal：page 态不归浏览器管，不能被事件顺手清掉。
  useEffect(() => {
    const sync = (): void => {
      setMode((prev) => {
        if (currentFullscreen() && currentFullscreen() === overlayRef.current) return 'browser';
        return prev === 'browser' ? 'normal' : prev;
      });
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  // 离开实验室时若还停在浏览器全屏，必须主动退出：覆盖层一旦从文档里消失，
  // 浏览器仍会把它顶在整屏上，用户只能靠 Esc 救场。
  useEffect(() => {
    const el = overlayRef.current;
    return () => {
      if (el && currentFullscreen() === el) exitFullscreen();
    };
  }, []);

  // 全屏态（网页 / 浏览器）：Esc 退出 + 锁住页面滚动，
  // 免得滚轮穿过浮层把背景滚走。浏览器真全屏的 Esc 会同时触发浏览器的退出。
  useEffect(() => {
    if (mode === 'normal') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (mode === 'browser') exitFullscreen();
      setMode('normal');
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mode]);

  // 从「普通态」直接点浏览器全屏：覆盖层要先渲染出来才有元素可全屏，
  // 所以先切 state，等 portal 落地后在 effect 里发起（此时用户激活仍在有效期内）。
  const pendingBrowserRef = useRef(false);
  useEffect(() => {
    if (mode !== 'browser' || !pendingBrowserRef.current) return;
    pendingBrowserRef.current = false;
    const el = overlayRef.current;
    if (el) enterFullscreen(el);
  }, [mode]);

  const togglePage = (): void => setMode((prev) => (prev === 'page' ? 'normal' : 'page'));

  const toggleBrowser = (): void => {
    if (mode === 'browser') {
      exitFullscreen();
      setMode('normal');
      return;
    }
    if (mode === 'page') {
      // 从网页全屏直接升级：覆盖层已经在了，直接对它发起
      const el = overlayRef.current;
      if (el) enterFullscreen(el);
      return;
    }
    pendingBrowserRef.current = true;
    setMode('browser');
  };

  const exitExpanded = (): void => {
    if (mode === 'browser') exitFullscreen();
    setMode('normal');
  };

  const chapters = lab.chapters;
  const activeIndex = useMemo(() => {
    const found = chapters.findIndex((item) => item.id === chapterId);
    return found >= 0 ? found : 0;
  }, [chapterId, chapters]);
  const active = chapters[activeIndex];
  const prev = activeIndex > 0 ? chapters[activeIndex - 1] : null;
  const next = activeIndex < chapters.length - 1 ? chapters[activeIndex + 1] : null;

  const track = index?.tracks.find((item) => item.id === lab.trackId);
  const expanded = mode !== 'normal';

  const overlay =
    expanded && typeof document !== 'undefined'
      ? createPortal(
          // fixed inset-0 对 browser 态也无害：真全屏时 UA 会接管尺寸；
          // 若 Fullscreen API 被拒，这里至少退化为网页全屏，不会白屏。
          <div
            ref={overlayRef}
            data-expand={mode}
            className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-[var(--surface)]"
          >
            <div className="flex h-11 flex-none items-center gap-2.5 overflow-x-auto border-b border-[var(--border)] px-3">
              <span className="tabular-nums text-[12.5px] text-[var(--text-3)]">
                第 {activeIndex + 1} / {chapters.length} 章
              </span>
              <span className="truncate text-[13.5px] font-medium text-[var(--text)]">{active.title}</span>
              <div className="ml-auto flex flex-none items-center gap-1.5">
                {prev ? (
                  <Link to={`${lab.route}/${prev.id}`} className="lh-btn !h-7 !px-2 !text-[12px]" title={prev.title}>
                    <Icon name="arrow-left" size={11} />
                    上一章
                  </Link>
                ) : null}
                {next ? (
                  <Link to={`${lab.route}/${next.id}`} className="lh-btn !h-7 !px-2 !text-[12px]" title={next.title}>
                    下一章
                    <Icon name="arrow-right" size={11} />
                  </Link>
                ) : null}
                {/* 网页全屏还能再升一级：不用先退出再点另一个按钮 */}
                {mode === 'page' ? (
                  <button
                    type="button"
                    onClick={toggleBrowser}
                    className="lh-btn !h-7 !px-2 !text-[12px]"
                    title="再进一步，连浏览器边框也隐去"
                  >
                    <Icon name="monitor" size={12} />
                    浏览器全屏
                  </button>
                ) : null}
                <span className="hidden text-[11.5px] text-[var(--text-3)] sm:inline">Esc 退出</span>
                <button
                  type="button"
                  onClick={exitExpanded}
                  className="lh-btn !h-7 !px-2 !text-[12px]"
                  title="退出（也可按 Esc）"
                >
                  <Icon name="collapse" size={12} />
                  {mode === 'page' ? '退出网页全屏' : '退出全屏'}
                </button>
              </div>
            </div>
            <iframe
              key={active.id}
              src={labChapterUrl(lab.baseDir, active.file)}
              title={`${active.title} · 动态图解`}
              className="block min-h-0 w-full flex-1 border-0 bg-white"
            />
          </div>,
          document.body,
        )
      : null;

  return (
    // xl 及以上：定高工作台（视口高 - 顶栏 - 页面上下留白），整页不再滚动，
    // 章节栏与正文各自管理高度 —— 否则外层滚动 + 章节栏被截 + iframe 内部滚动
    // 会叠成三四条滚动条。窄屏仍走常规文档流。
    // 81 = 40 上留白 + 40 下留白 + 1px（顶栏 h-[--header-h] 之外还有一条下边框）
    <div
      data-accent={track?.accent ?? 'cyan'}
      className="mx-auto max-w-[1280px] xl:flex xl:h-[calc(100dvh-var(--header-h)-81px)] xl:min-h-[520px] xl:flex-col"
    >
      <nav className="mb-4 flex items-center gap-1.5 text-[12.5px] text-[var(--text-3)] xl:mb-3 xl:flex-none">
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
        <span className="text-[var(--text-2)]">{lab.title}</span>
      </nav>

      <header className="mb-6 xl:mb-4 xl:flex-none">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px] xl:text-[23px]">
          {lab.title}
        </h1>
        <p className="mt-2.5 max-w-[720px] text-[14.5px] leading-[1.7] text-[var(--text-2)] xl:mt-1 xl:line-clamp-1 xl:text-[13px]">
          {lab.subtitle}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 xl:mt-2">
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
      <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[228px_minmax(0,1fr)]">
        {/* 章节导航：桌面固定 228px 且只在自己那一列内滚动（兜底），移动端横向滚动。
            min-w-0 必须有：grid 子项默认 min-width:auto，会被横滑条里
            多张 220px 卡片的 min-content 撑开，导致整页横向溢出。 */}
        <aside className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
          <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">
            章节
          </p>
          <ol className="flex gap-2 overflow-x-auto pb-2 xl:flex-col xl:gap-1.5 xl:overflow-visible xl:pb-0">
            {chapters.map((chapter, i) => {
              const on = i === activeIndex;
              return (
                <li key={chapter.id} className="shrink-0 xl:shrink">
                  <Link
                    to={`${lab.route}/${chapter.id}`}
                    aria-current={on ? 'page' : undefined}
                    className={[
                      'flex h-full w-[220px] flex-col rounded-[var(--radius-md)] border p-3 transition-colors duration-100 xl:w-auto xl:p-2.5',
                      on
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
                    ].join(' ')}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="tabular-nums text-[11px] text-[var(--text-3)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[13.5px] font-medium leading-snug text-[var(--text)] xl:text-[13px]">
                        {chapter.title}
                      </span>
                    </span>
                    {/* 未选中章节的原理句只在窄屏（横向卡片）显示；
                        xl 下只给当前章留两行，其余压到单行标题，保证 7 章能在一屏内放下 */}
                    <span
                      className={[
                        'mt-1 line-clamp-2 text-[11.5px] leading-[1.6] text-[var(--text-3)]',
                        on ? '' : 'xl:hidden',
                      ].join(' ')}
                    >
                      {chapter.principle}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          <p className="mt-3 hidden px-1 text-[11px] leading-[1.6] text-[var(--text-3)] xl:block">
            点步骤条定格 · 点部件高亮
          </p>
        </aside>

        {/* 图解正文。用 div 而不是 main：外层 Layout 已经是 <main>，
            嵌套 main 违反 HTML 规范，会破坏读屏器的地标导航。 */}
        <div className="min-w-0 xl:flex xl:min-h-0 xl:flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 xl:mb-2 xl:flex-none">
            <span className="text-[12.5px] text-[var(--text-3)]">
              第 {activeIndex + 1} / {chapters.length} 章
            </span>
            <span className="text-[15px] font-medium text-[var(--text)] xl:text-[14px]">{active.title}</span>
            <Link
              to={active.articleRoute}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-[var(--brand)] hover:underline"
            >
              阅读文章：{active.articleTitle}
              <Icon name="arrow-right" size={12} />
            </Link>
            {/* xl 下把底部翻页卡收进工具栏，省出正文高度 */}
            <div className="hidden items-center gap-1.5 xl:flex">
              {prev ? (
                <Link to={`${lab.route}/${prev.id}`} className="lh-btn !h-7 !px-2 !text-[12px]" title={prev.title}>
                  <Icon name="arrow-left" size={11} />
                  上一章
                </Link>
              ) : null}
              {next ? (
                <Link to={`${lab.route}/${next.id}`} className="lh-btn !h-7 !px-2 !text-[12px]" title={next.title}>
                  下一章
                  <Icon name="arrow-right" size={11} />
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              onClick={togglePage}
              aria-pressed={mode === 'page'}
              title="网页全屏：图解铺满页面，顶栏与侧栏让位（Esc 退出）"
              className="lh-btn !h-7 !px-2 !text-[12px]"
            >
              <Icon name={mode === 'page' ? 'collapse' : 'expand'} size={12} />
              网页全屏
            </button>
            <button
              type="button"
              onClick={toggleBrowser}
              aria-pressed={mode === 'browser'}
              title="浏览器全屏：连浏览器边框一起隐去（Esc 退出）"
              className="lh-btn !h-7 !px-2 !text-[12px]"
            >
              <Icon name={mode === 'browser' ? 'collapse' : 'monitor'} size={12} />
              浏览器全屏
            </button>
          </div>

          {/* 全屏时覆盖层经 portal 挂到 body，这里不再渲染第二份 iframe ——
              全站任何时刻只有一个图解 iframe、一条全屏工具条。 */}
          {expanded ? null : (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] xl:min-h-0 xl:flex-1">
              <iframe
                key={active.id}
                src={labChapterUrl(lab.baseDir, active.file)}
                title={`${active.title} · 动态图解`}
                className="block h-[calc(100dvh-260px)] min-h-[620px] w-full border-0 bg-white xl:h-full xl:min-h-0"
              />
            </div>
          )}
        </div>
      </div>

      {overlay}
    </div>
  );
}
