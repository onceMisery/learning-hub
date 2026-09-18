import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { SearchDialog } from './SearchDialog';
import { Sidebar } from './Sidebar';
import { ErrorState } from './ui/States';
import { useContentIndex } from '@/hooks/useContentIndex';
import { cn } from '@/lib/format';
import { useProgress } from '@/lib/progress';
import { useSidebar } from '@/lib/sidebar';
import type { ContentIndex } from '@/types/content';

export interface ShellContextValue {
  /** 页面自行声明右侧栏内容；没有右侧栏的页面传 null */
  setRight: (node: ReactNode | null) => void;
  index: ContentIndex | null;
}

export function useShell(): ShellContextValue {
  return useOutletContext<ShellContextValue>();
}

/**
 * 站点外壳：顶栏 + 侧边导航 + 内容区 + 可选右侧栏。
 *
 * 用嵌套路由承载，保证顶栏与侧边栏在页面切换时不重新挂载，
 * 侧边栏的展开状态与滚动位置因此得以保留。
 */
export function Layout() {
  const location = useLocation();
  const { index, loading, error, reload } = useContentIndex();
  const { statusOf } = useProgress();
  const [right, setRight] = useState<ReactNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { collapsed, toggle: toggleSidebar } = useSidebar();

  // 路由变化后回到顶部；带 hash 时交给浏览器滚动到锚点
  useEffect(() => {
    if (location.hash) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname, location.hash]);

  // 移动端抽屉在路由变化时自动关闭
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // 抽屉打开时支持 Esc 关闭，键盘用户不必去找关闭按钮
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeTrackId = useMemo(() => {
    const match = /^\/([^/]+)/.exec(location.pathname);
    const first = match?.[1];
    if (!first || !index) return undefined;
    return index.tracks.some((track) => track.id === first) ? first : undefined;
  }, [location.pathname, index]);

  const doneIds = useMemo(() => {
    if (!index) return undefined;
    const set = new Set<string>();
    for (const id of Object.keys(index.pages)) {
      if (statusOf(id) === 'done') set.add(id);
    }
    return set;
  }, [index, statusOf]);

  const context = useMemo<ShellContextValue>(() => ({ setRight, index }), [index]);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-md">
        {/* 与主体共用同一个容器（max-w-[var(--shell-max)] + 同样的左右内边距），
            保证顶栏的按钮/导航与下方侧边栏、正文严格左对齐。 */}
        <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[var(--shell-max)] items-center gap-2 px-4 sm:px-6">
          <button
            type="button"
            className="lh-btn !h-8 !w-8 !px-0 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            aria-expanded={drawerOpen}
            aria-controls="mobile-sidebar"
          >
            <Icon name="menu" size={16} />
          </button>

          {/* 桌面端的侧栏开关：与上面的汉堡按钮互斥（窄屏是抽屉，宽屏才是整列收起） */}
          <button
            type="button"
            className="lh-btn hidden !h-8 !w-8 !px-0 lg:inline-flex"
            onClick={toggleSidebar}
            aria-label={collapsed ? '展开侧边导航' : '收起侧边导航'}
            aria-expanded={!collapsed}
            aria-controls="desktop-sidebar"
            title={collapsed ? '展开侧边导航' : '收起侧边导航'}
          >
            <Icon name="panel-left" size={16} />
          </button>

          <Link to="/" className="flex items-center gap-2 rounded-[var(--radius-sm)] pr-1">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[13px] font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, #a855f7))' }}
              aria-hidden="true"
            >
              J
            </span>
            <span className="hidden text-[14px] font-medium tracking-tight sm:block">
              learning-hub
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            <HeaderLink to="/" label="首页" pathname={location.pathname} />
            <HeaderLink to="/compare" label="对照中心" pathname={location.pathname} />
            <HeaderLink to="/progress" label="我的进度" pathname={location.pathname} />
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="lh-btn !h-8 gap-2 !pl-2.5 !pr-2 text-[12.5px] sm:!w-52"
              onClick={() => setSearchOpen(true)}
              aria-label="搜索"
            >
              <Icon name="search" size={14} />
              <span className="hidden flex-1 text-left text-[var(--text-3)] sm:block">搜索…</span>
              <kbd className="hidden rounded border border-[var(--border)] px-1 text-[10.5px] text-[var(--text-3)] sm:block">
                ⌘K
              </kbd>
            </button>
            <a
              className="lh-btn !h-8 !w-8 !px-0"
              href={index?.repoUrl ?? 'https://github.com/onceMisery/learning-hub'}
              target="_blank"
              rel="noreferrer"
              aria-label="在 GitHub 上查看"
              title="在 GitHub 上查看"
            >
              <Icon name="github" size={15} />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* 三列的间距不再用 gap，而是由各列自己的 margin 承担 ——
          这样侧边栏收起时能连同它右侧那 32px 一起让给正文，
          否则 gap 会留下一段"没有内容的空白"。 */}
      <div className="mx-auto flex w-full max-w-[var(--shell-max)] px-4 sm:px-6">
        {/* 侧边导航整列可收起。用 CSS 过渡而不是 JS 动画，是为了直接对
            var(--sidebar-w) 做插值，不必在 JS 里再抄一份宽度常量。
            overflow-clip（而不是 hidden）是因为 sticky 元素在 hidden 容器里会失去吸顶
            ——clip 不建立滚动容器，吸顶照旧。 */}
        <aside
          id="desktop-sidebar"
          data-collapsed={collapsed}
          inert={collapsed}
          className={cn(
            'sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] shrink-0 overflow-clip transition-[width,margin-right] duration-[var(--dur-slow)] ease-[var(--ease-out)] lg:block',
            collapsed ? 'w-0' : 'mr-8 w-[var(--sidebar-w)]',
          )}
        >
          <div className="h-full w-[var(--sidebar-w)] overflow-y-auto py-6 pr-2">
            {index ? (
              <Sidebar
                index={index}
                activeTrackId={activeTrackId}
                doneIds={doneIds}
              />
            ) : loading ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-2)]" />
                ))}
              </div>
            ) : null}
          </div>
        </aside>

        <AnimatePresence>
          {drawerOpen ? (
            <motion.div
              className="fixed inset-0 z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
              <motion.aside
                id="mobile-sidebar"
                className="absolute left-0 top-0 h-full w-[82vw] max-w-[320px] overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] px-4 pb-10 pt-4"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
                aria-label="移动端导航"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-2)]">全部轨道</span>
                  <button
                    type="button"
                    className="lh-btn !h-8 !w-8 !px-0"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="关闭导航"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
                {index ? (
                  <Sidebar
                    index={index}
                    activeTrackId={activeTrackId}
                    doneIds={doneIds}
                    onNavigate={() => setDrawerOpen(false)}
                  />
                ) : null}
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* 内容区上下留白比侧边栏略大，让正文与顶栏/视口边界保持呼吸感 */}
        <main className="min-w-0 flex-1 py-8 lg:py-10">
          {error ? (
            <div className="mx-auto max-w-[var(--content-max)]">
              <ErrorState
                title="内容索引加载失败"
                description={error.message}
                action={
                  <button type="button" className="lh-btn" onClick={reload}>
                    重新加载
                  </button>
                }
              />
            </div>
          ) : (
            <Outlet context={context} />
          )}
        </main>

        {/* 右侧栏只在页面真的发布了内容时才占位。
            以前这里恒定渲染一个 w-[var(--toc-w)] 的空 aside，导致首页 / 对照中心 /
            进度页在 xl 断点白白损失 232px 宽度 + 32px 间距——对照中心六列的表
            就是被这块空地挤到没法看的。 */}
        {right ? (
          <aside className="sticky top-[var(--header-h)] ml-8 hidden h-[calc(100dvh-var(--header-h))] w-[var(--toc-w)] shrink-0 overflow-y-auto py-8 pl-1 xl:block">
            {right}
          </aside>
        ) : null}
      </div>

      <SearchDialog open={searchOpen} onClose={closeSearch} index={index} />
    </div>
  );
}

function HeaderLink({ to, label, pathname }: { to: string; label: string; pathname: string }) {
  const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={[
        'rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] transition-colors duration-100',
        active ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}
