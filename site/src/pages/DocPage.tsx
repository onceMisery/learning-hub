import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { NoteLayer } from '@/components/notes/NoteLayer';
import { Toc } from '@/components/Toc';
import { useShell } from '@/components/Layout';
import { DocSkeleton, ErrorState } from '@/components/ui/States';
import { ContentError, loadPage } from '@/lib/content';
import { redundantFlags } from '@/lib/doc-structure';
import { collectUnits, type InlineMark } from '@/lib/note-anchor';
import { reconcileNotes, useNotes } from '@/lib/notes';
import { markVisited, useProgress } from '@/lib/progress';
import { formatDate } from '@/lib/format';
import type { PageDocument } from '@/types/content';

interface DocState {
  doc: PageDocument | null;
  loading: boolean;
  error: Error | null;
}

/** 无划线的段落共用同一个空数组，避免把纯展示的段落拖进 re-render */
const EMPTY_MARKS: InlineMark[] = [];

/** 还没有正文时的跳过标记（空数组 = 一个都不跳） */
const EMPTY_FLAGS: boolean[] = [];

export function DocPage() {
  const { trackId, sectionId, slug } = useParams<{ trackId: string; sectionId: string; slug: string }>();
  const { index, setRight } = useShell();
  const { statusOf, toggle } = useProgress();
  const [state, setState] = useState<DocState>({ doc: null, loading: true, error: null });

  const pageId = trackId && sectionId && slug ? `${trackId}/${sectionId}/${slug}` : null;
  const meta = pageId && index ? index.pages[pageId] : undefined;

  const noteRootRef = useRef<HTMLDivElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const { notes, add, update, remove, storageError } = useNotes(pageId);

  // 正文按页懒加载；切换页面时取消上一次未完成的请求，避免竞态导致内容错位
  useEffect(() => {
    if (!pageId) {
      setState({ doc: null, loading: false, error: new ContentError('页面地址不完整') });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ doc: prev.doc?.meta.id === pageId ? prev.doc : null, loading: true, error: null }));

    loadPage(pageId, controller.signal)
      .then((doc) => setState({ doc, loading: false, error: null }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ doc: null, loading: false, error: error as Error });
      });

    return () => controller.abort();
  }, [pageId]);

  // 右侧目录随正文就绪后发布给外壳
  useEffect(() => {
    setRight(state.doc ? <Toc headings={state.doc.meta.headings} /> : null);
    return () => setRight(null);
  }, [state.doc, setRight]);

  useEffect(() => {
    if (pageId) markVisited(pageId);
  }, [pageId]);

  // 换页时收起笔记抽屉，避免它悬在另一篇文档上（内容还对不上）
  useEffect(() => setNotesOpen(false), [pageId]);

  /**
   * 正文里哪些块属于「与页头重复、不该渲染」。
   * 渲染层（Markdown 的 skipBlocks）与锚点层（collectUnits 的 skip）必须共用这一份，
   * 详见 lib/doc-structure.ts。没有正文时给空数组，免得下游多一条判空分支。
   */
  const skipBlocks = useMemo(
    () => (state.doc ? redundantFlags(state.doc.blocks, state.doc.meta.title) : EMPTY_FLAGS),
    [state.doc],
  );

  // 正文就绪后用最新的锚点单元校正笔记坐标：内容被改写后在这里自愈，
  // 找不回来的片段会被标记为失效，但笔记内容始终保留。
  useEffect(() => {
    const doc = state.doc;
    if (!doc) return;
    reconcileNotes(doc.meta.id, collectUnits(doc.blocks, '', skipBlocks));
  }, [state.doc, skipBlocks]);

  /** 路径 → 该锚点单元上的划线标记。同一篇文档内笔记区间互不相交，所以无需处理叠加。 */
  const marksByPath = useMemo(() => {
    const map = new Map<string, InlineMark[]>();
    for (const note of notes) {
      if (note.orphaned) continue;
      const hasNote = note.note.trim().length > 0;
      for (const segment of note.segments) {
        if (segment.end <= segment.start) continue;
        const mark: InlineMark = {
          id: note.id,
          style: note.style,
          color: note.color,
          start: segment.start,
          end: segment.end,
          hasNote,
        };
        const list = map.get(segment.path);
        if (list) list.push(mark);
        else map.set(segment.path, [mark]);
      }
    }
    return map;
  }, [notes]);

  const segmentsOf = useCallback((path: string): InlineMark[] => marksByPath.get(path) ?? EMPTY_MARKS, [marksByPath]);

  const track = useMemo(
    () => index?.tracks.find((item) => item.id === trackId),
    [index, trackId],
  );
  const section = useMemo(
    () => track?.sections.find((item) => item.id === sectionId),
    [track, sectionId],
  );

  if (!index) return null;

  // 索引里就没有这一页：直接给出「不存在」，不去做一次注定失败的请求
  if (!meta) {
    return (
      <div className="mx-auto max-w-[var(--content-max)]">
        <ErrorState
          title="页面不存在"
          description={`索引里找不到「${pageId ?? '未知'}」。可能是 slug 变了，或内容尚未重新生成。`}
          action={
            <Link to={trackId ? `/${trackId}` : '/'} className="lh-btn">
              <Icon name="arrow-left" size={13} />
              {trackId ? '返回轨道首页' : '返回首页'}
            </Link>
          }
        />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mx-auto max-w-[var(--content-max)]">
        <ErrorState
          title="这篇文档没能加载出来"
          description={state.error.message}
          action={
            <Link to={trackId ? `/${trackId}` : '/'} className="lh-btn">
              <Icon name="arrow-left" size={13} />
              {trackId ? '返回轨道首页' : '返回首页'}
            </Link>
          }
        />
      </div>
    );
  }

  const doc = state.doc;
  const verified = formatDate(track?.verifiedAt);
  const updated = formatDate(meta.updatedAt);
  const done = pageId ? statusOf(pageId) === 'done' : false;
  const prevPage = meta.prevId ? index.pages[meta.prevId] : undefined;
  const nextPage = meta.nextId ? index.pages[meta.nextId] : undefined;

  return (
    <div data-accent={track?.accent ?? 'teal'} className="mx-auto max-w-[var(--content-max)]">
      <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--text-3)]">
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
        <span className="text-[var(--text-2)]">{section?.title ?? meta.sectionId}</span>
      </nav>

      <header className="mb-7">
        <h1 className="text-[26px] font-semibold leading-[1.3] tracking-tight sm:text-[30px]">{meta.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[var(--text-3)]">
          <span>{meta.readingMinutes} 分钟</span>
          {updated ? (
            <>
              <span aria-hidden="true">·</span>
              <span>更新于 {updated}</span>
            </>
          ) : null}
          {verified ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                基于 {track?.toolchain || '当前版本'}，{verified} 验证
              </span>
            </>
          ) : null}
          {pageId ? (
            <button
              type="button"
              className="lh-btn ml-auto !h-7 !px-2.5 !text-[12px]"
              onClick={() => setNotesOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={notesOpen}
              title="查看本页的全部划线笔记"
            >
              <Icon name="list" size={13} />
              划线笔记
              {notes.length > 0 ? (
                <span className="rounded-full bg-[var(--brand-soft)] px-1.5 text-[11px] leading-[16px] text-[var(--brand)]">
                  {notes.length}
                </span>
              ) : null}
            </button>
          ) : null}
          {pageId ? (
            <button
              type="button"
              className="lh-btn !h-7 !px-2.5 !text-[12px]"
              onClick={() => toggle(pageId)}
              aria-pressed={done}
              title={done ? '标记为未完成' : '标记为已完成'}
            >
              <Icon name={done ? 'check' : 'target'} size={13} />
              {done ? '已完成' : '标记完成'}
            </button>
          ) : null}
        </div>
      </header>

      {meta.part ? (
        <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[12.5px] text-[var(--text-2)]">
          这是长文拆分的第 {meta.part.index + 1} / {meta.part.total} 部分：{meta.part.label}
        </div>
      ) : null}

      {/* 划线笔记的根容器：只有落在这个范围内的选区才会被识别成划线，
          侧边栏、顶栏里的选中文字不会误触发。 */}
      <div ref={noteRootRef} data-note-root>
        {state.loading && !doc ? (
          <DocSkeleton />
        ) : doc ? (
          <motion.article
            key={doc.meta.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.215, 0.61, 0.355, 1] }}
          >
            <Markdown
              blocks={doc.blocks}
              repoUrl={index.repoUrl}
              trackDir={`tracks/${doc.track.id}`}
              segmentsOf={segmentsOf}
              /* 页头（上面的 h1）已经显示了标题，正文开头若再写一遍就不再渲染 */
              skipBlocks={skipBlocks}
            />
          </motion.article>
        ) : null}
      </div>

      {meta.tags.length > 0 ? (
        <div className="mt-10 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-5">
          {meta.tags.map((tag) => (
            <span key={tag} className="lh-chip">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      <nav className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="上下篇导航">
        {prevPage ? (
          <Link
            to={prevPage.route}
            className="group rounded-[var(--radius-md)] border border-[var(--border)] p-3.5 transition-colors hover:border-[var(--border-strong)]"
          >
            <span className="flex items-center gap-1 text-[11.5px] text-[var(--text-3)]">
              <Icon name="arrow-left" size={12} />
              上一篇
            </span>
            <span className="mt-1 block line-clamp-2 text-[13.5px] text-[var(--text)]">{prevPage.title}</span>
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        {nextPage ? (
          <Link
            to={nextPage.route}
            className="group rounded-[var(--radius-md)] border border-[var(--border)] p-3.5 text-right transition-colors hover:border-[var(--border-strong)] sm:col-start-2"
          >
            <span className="flex items-center justify-end gap-1 text-[11.5px] text-[var(--text-3)]">
              下一篇
              <Icon name="arrow-right" size={12} />
            </span>
            <span className="mt-1 block line-clamp-2 text-[13.5px] text-[var(--text)]">{nextPage.title}</span>
          </Link>
        ) : null}
      </nav>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-[12.5px] text-[var(--text-3)]">
        <a
          className="inline-flex items-center gap-1 hover:text-[var(--text)]"
          href={`${index.repoUrl}/edit/main/${meta.sourceFile.split('/').map(encodeURIComponent).join('/')}`}
          target="_blank"
          rel="noreferrer"
        >
          在 GitHub 编辑此页
          <Icon name="external" size={11} />
        </a>
        <span aria-hidden="true">·</span>
        <span className="font-mono text-[11.5px]">{meta.sourceFile}</span>
      </div>

      {pageId ? (
        <NoteLayer
          pageId={pageId}
          notes={notes}
          rootRef={noteRootRef}
          add={add}
          update={update}
          remove={remove}
          storageError={storageError}
          listOpen={notesOpen}
          onListOpenChange={setNotesOpen}
        />
      ) : null}
    </div>
  );
}
