import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon } from '@/components/Icon';
import { TrackCard } from '@/components/TrackCard';
import { EmptyState } from '@/components/ui/States';
import { useShell } from '@/components/Layout';
import { useProgress } from '@/lib/progress';
import { formatCount } from '@/lib/format';

export function HomePage() {
  const { index, setRight } = useShell();
  const { recent, statusOf } = useProgress();

  // 首页没有右侧目录
  useEffect(() => {
    setRight(null);
  }, [setRight]);

  // 只有首页按最新发布优先：索引里的 order 仍是侧边栏与进度页沿用的课程顺序
  const tracks = useMemo(
    () =>
      [...(index?.tracks ?? [])].sort((a, b) =>
        a.verifiedAt < b.verifiedAt ? 1 : a.verifiedAt > b.verifiedAt ? -1 : a.order - b.order,
      ),
    [index],
  );

  const doneByTrack = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) {
      const done = track.sections.reduce(
        (sum, section) => sum + section.pages.filter((page) => statusOf(page.id) === 'done').length,
        0,
      );
      map.set(track.id, done);
    }
    return map;
  }, [tracks, statusOf]);

  const recentPages = useMemo(() => {
    if (!index) return [];
    return recent
      .map((item) => index.pages[item.id])
      .filter((page): page is NonNullable<typeof page> => Boolean(page))
      .slice(0, 5);
  }, [recent, index]);

  if (!index) return null;

  return (
    <div className="mx-auto max-w-[1080px]">
      {/* Hero：标题 → 正文 → 数据，三层之间用递增间距拉开主次 */}
      <section className="mb-12 sm:mb-14">
        <p className="lh-eyebrow mb-4 flex items-center gap-2">
          <Icon name="sparkles" size={13} />
          From Java to X
        </p>
        <h1 className="text-[30px] font-semibold leading-[1.3] tracking-tight sm:text-[38px]">
          面向 Java 工程师的
          <br className="sm:hidden" />
          第二语言学习轨道
        </h1>
        <p className="mt-4 max-w-[640px] text-[15px] leading-[1.8] text-[var(--text-2)]">
          每条轨道都由系统教程、可运行的实战项目和与 Java 的对照三部分组成。
          不堆砌语法，只回答两个问题：这门语言为什么这样设计，以及我该怎么写真实项目。
        </p>

        {/* 数据条：用一条分隔线把它从正文里独立出来，窄屏两列、宽屏一行 */}
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-[var(--border)] pt-7 sm:flex sm:flex-wrap sm:gap-x-14">
          <Stat label="学习轨道" value={String(index.stats.tracks)} />
          <Stat label="文档篇数" value={String(index.stats.pages)} />
          <Stat label="正文总字数" value={formatCount(index.stats.words)} />
          <Stat label="代码块" value={formatCount(index.stats.codeBlocks)} />
        </dl>
      </section>

      {/* 继续学习 */}
      {recentPages.length > 0 ? (
        <section className="mb-12">
          <h2 className="lh-eyebrow mb-4">继续上次</h2>
          <ul className="flex flex-wrap gap-2.5">
            {recentPages.map((page) => (
              <li key={page.id}>
                <Link
                  to={page.route}
                  className="lh-btn !h-9 max-w-[300px] !justify-start !gap-2 !px-3.5 !text-[13px]"
                  title={page.title}
                >
                  <Icon name="clock" size={13} />
                  <span className="truncate">{page.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 轨道列表 */}
      <section>
        <h2 className="lh-eyebrow mb-4">全部轨道</h2>
        {tracks.length === 0 ? (
          <EmptyState
            title="还没有任何轨道"
            description="在 tracks/ 下新建一个目录并添加 track.json，重新构建后即可出现在这里。"
          />
        ) : (
          <motion.div
            className="grid gap-5 sm:grid-cols-2 lg:gap-6"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          >
            {tracks.map((track) => (
              <motion.div
                key={track.id}
                className="h-full"
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  show: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.28, ease: [0.215, 0.61, 0.355, 1] }}
              >
                <TrackCard track={track} doneCount={doneByTrack.get(track.id) ?? 0} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="lh-eyebrow truncate">{label}</dt>
      <dd className="mt-2 text-[22px] font-semibold leading-none tracking-tight tabular-nums text-[var(--text)]">
        {value}
      </dd>
    </div>
  );
}
