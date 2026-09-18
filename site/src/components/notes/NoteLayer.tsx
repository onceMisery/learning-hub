import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  anchorSelection,
  findOverlapping,
  previewOf,
  segmentSignature,
  subtractSegments,
  toAnchorRect,
  DEFAULT_NOTE_COLOR,
  type AnchorRect,
  type NoteColor,
  type NoteStyle,
  type RawSegment,
} from '@/lib/note-anchor';
import { truncate } from '@/lib/format';
import type { NoteInput, NotePatch, NoteRecord } from '@/lib/notes';
import { NoteEditor } from './NoteEditor';
import { NoteList } from './NoteList';
import { NoteToolbar } from './NoteToolbar';

interface NoteLayerProps {
  pageId: string;
  notes: NoteRecord[];
  /** 正文容器：所有选区都必须落在它内部才会被识别 */
  rootRef: RefObject<HTMLDivElement | null>;
  add: (input: NoteInput) => NoteRecord | null;
  update: (id: string, patch: NotePatch) => void;
  remove: (id: string) => void;
  storageError: boolean;
  listOpen: boolean;
  onListOpenChange: (open: boolean) => void;
}

/**
 * 划线的四种状态。用一个状态机而不是四个布尔量，
 * 是因为"菜单 / 新建 / 编辑"互斥且各自的载荷不同，布尔量很快就会互相打架。
 */
type Draft =
  /** menu 态也带 style：它是"接下来用哪种样式"的暂存，切换后点色点才落地 */
  | { mode: 'menu'; raw: RawSegment[]; anchor: AnchorRect; style: NoteStyle }
  | { mode: 'create'; raw: RawSegment[]; style: NoteStyle; color: NoteColor; note: string }
  | { mode: 'edit'; id: string; style: NoteStyle; color: NoteColor; note: string };

const TOAST_MS = 2400;
/** 点击标记后短暂屏蔽选区判定，避开"mouseup 的延时求值"反过来覆盖编辑态 */
const SUPPRESS_MS = 260;

/**
 * 划线笔记的交互编排层。
 *
 * 职责边界：
 *   · 监听选区（拖选 / 长按 / 键盘选择）→ 解析成锚点 → 弹操作菜单；
 *   · 把"新建 / 编辑 / 删除 / 定位"接到存储层；
 *   · 所有浮层都走 portal 挂到 body —— 正文里挂着 motion.article（带 transform），
 *     在那里面用 position: fixed 会被它的包含块吃掉，位置会算错。
 * 渲染（把划线的样子画出来）不在这里，在 Markdown 里完成。
 */
export function NoteLayer({
  pageId,
  notes,
  rootRef,
  add,
  update,
  remove,
  storageError,
  listOpen,
  onListOpenChange,
}: NoteLayerProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const suppressUntil = useRef(0);
  // 事件回调挂在 document 上、只绑定一次，所以用 ref 读取"最新值"
  const draftRef = useRef<Draft | null>(null);
  const notesRef = useRef(notes);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const pushToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  /** 读取当前选区并解析成锚点；不在正文内、或为空选区时返回 null */
  const readSelection = useCallback((): { raw: RawSegment[]; anchor: AnchorRect } | null => {
    const root = rootRef.current;
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;

    const raw = anchorSelection(root, range);
    if (raw.length === 0) return null;

    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    if (rect && (rect.width > 0 || rect.height > 0)) return { raw, anchor: toAnchorRect(rect) };

    // 选区拿不到几何信息（测试环境、纯空白行）时退化为视口中央，
    // 至少保证菜单是可用的，而不是定位到 (0,0) 被顶栏挡住。
    const centerY = window.innerHeight / 2;
    return {
      raw,
      anchor: { top: centerY - 24, left: window.innerWidth / 2 - 60, width: 120, height: 20, bottom: centerY - 4 },
    };
  }, [rootRef]);

  const openEditor = useCallback((id: string) => {
    const note = notesRef.current.find((item) => item.id === id);
    if (!note) return;
    suppressUntil.current = Date.now() + SUPPRESS_MS;
    window.getSelection()?.removeAllRanges();
    setDraft({ mode: 'edit', id: note.id, style: note.style, color: note.color, note: note.note });
  }, []);

  const locate = useCallback(
    (id: string) => {
      const selector = `mark[data-note-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`;
      const mark = document.querySelector<HTMLElement>(selector);
      if (!mark) {
        pushToast('这条笔记的原文位置已经找不到了');
        return;
      }
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mark.classList.add('lh-hl--flash');
      window.setTimeout(() => mark.classList.remove('lh-hl--flash'), 1400);
      // 窄屏抽屉会盖住正文，定位后自动收起
      if (window.innerWidth < 1024) onListOpenChange(false);
    },
    [onListOpenChange, pushToast],
  );

  /** 落地一条新笔记：先把与已有划线重叠的部分剪掉 */
  const apply = useCallback(
    (raw: RawSegment[], style: NoteStyle, color: NoteColor, note: string) => {
      const existing = notesRef.current.filter((item) => !item.orphaned).flatMap((item) => item.segments);
      const pieces = subtractSegments(raw, existing);

      if (pieces.length === 0) {
        // 完全被已有划线覆盖：不去改已有数据，直接引导用户编辑那一条
        const hit = findOverlapping(notesRef.current, raw);
        window.getSelection()?.removeAllRanges();
        if (hit) {
          setDraft({ mode: 'edit', id: hit.id, style: hit.style, color: hit.color, note: hit.note });
          pushToast('这段文字已经划过了，可直接编辑这条笔记');
        } else {
          setDraft(null);
          pushToast('这段文字已经划过了');
        }
        return;
      }

      const skipped = pieces.length !== raw.length;
      add({
        pageId,
        style,
        color,
        segments: pieces,
        note,
        text: truncate(pieces.map((piece) => piece.quote).join(' … '), 300),
      });
      window.getSelection()?.removeAllRanges();
      setDraft(null);
      if (skipped) pushToast('已跳过与已有划线重叠的部分');
      else pushToast(note.trim() ? '笔记已保存' : '已划线');
    },
    [add, pageId, pushToast],
  );

  const patchDraft = useCallback((patch: { style?: NoteStyle; color?: NoteColor; note?: string }) => {
    setDraft((prev) => (prev && prev.mode !== 'menu' ? { ...prev, ...patch } : prev));
  }, []);

  /** menu 态的样式开关：只换"接下来用哪种样式"，不落地 */
  const setMenuStyle = useCallback((style: NoteStyle) => {
    setDraft((prev) => (prev && prev.mode === 'menu' ? { ...prev, style } : prev));
  }, []);

  const handleSave = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    if (current.mode === 'create') {
      apply(current.raw, current.style, current.color, current.note);
      return;
    }
    if (current.mode === 'edit') {
      update(current.id, { style: current.style, color: current.color, note: current.note });
      setDraft(null);
      pushToast('笔记已更新');
    }
  }, [apply, pushToast, update]);

  const handleDelete = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.mode !== 'edit') return;
    remove(current.id);
    setDraft(null);
    pushToast('笔记已删除');
  }, [pushToast, remove]);

  /* -------------------------------------------------------------- */
  /* 选区监听                                                        */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const insideUi = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-note-ui]') !== null;

    const evaluate = (): void => {
      if (Date.now() < suppressUntil.current) return;
      const current = draftRef.current;
      // 编辑 / 新建态下不抢：否则用户一动光标就把正在写的笔记顶掉
      if (current && current.mode !== 'menu') return;

      const found = readSelection();
      if (!found) {
        if (current?.mode === 'menu') setDraft(null);
        return;
      }
      // 指纹相同就不再 setState，避免 selectionchange 的反复触发造成抖动
      if (current?.mode === 'menu' && segmentSignature(current.raw) === segmentSignature(found.raw)) return;
      // 换选区时保留已切好的样式：用户切到下划线后又改选了一段，不该被打回高亮
      const keptStyle = draftRef.current && draftRef.current.mode === 'menu' ? draftRef.current.style : 'highlight';
      setDraft({ mode: 'menu', raw: found.raw, anchor: found.anchor, style: keptStyle });
    };

    // 等浏览器把选区定下来再读，否则拿到的是拖选过程中的中间状态
    const onPointerUp = (event: Event): void => {
      if (insideUi(event.target)) return;
      window.setTimeout(evaluate, 0);
    };

    // 移动端长按后拖动手柄不一定再触发 touchend / mouseup，用 selectionchange 兜一层
    let timer = 0;
    const onSelectionChange = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 320);
    };

    // 菜单贴在选区上，滚动后就失去参照，直接收起；编辑弹层是居中的，不受滚动影响
    const onViewportChange = (): void => {
      if (draftRef.current?.mode === 'menu') setDraft(null);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && draftRef.current) {
        event.preventDefault();
        setDraft(null);
      }
    };

    // 正文里的标记用事件委托统一处理：标记可能被切成多片，逐个绑定不现实
    const onRootClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const mark = target.closest('mark[data-note-id]');
      const id = mark?.getAttribute('data-note-id');
      if (!id) return;
      // 划线压在链接上时，点击优先理解为"看笔记"而不是跳转
      event.preventDefault();
      event.stopPropagation();
      openEditor(id);
    };

    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('keyup', onPointerUp);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', onRootClick);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchend', onPointerUp);
      document.removeEventListener('keyup', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('click', onRootClick);
    };
  }, [openEditor, readSelection, rootRef]);

  /* -------------------------------------------------------------- */
  /* 渲染                                                            */
  /* -------------------------------------------------------------- */

  const editing = draft && draft.mode === 'edit' ? notes.find((item) => item.id === draft.id) : undefined;
  const quote = draft && draft.mode === 'create' ? previewOf(draft.raw) : editing?.text ?? '';

  return createPortal(
    <>
      {draft && draft.mode === 'menu' ? (
        <NoteToolbar
          anchor={draft.anchor}
          style={draft.style}
          onStyleChange={setMenuStyle}
          onPick={(color) => apply(draft.raw, draft.style, color, '')}
          onNote={() =>
            setDraft({
              mode: 'create',
              raw: draft.raw,
              style: draft.style,
              color: DEFAULT_NOTE_COLOR,
              note: '',
            })
          }
          onDismiss={() => {
            window.getSelection()?.removeAllRanges();
            setDraft(null);
          }}
        />
      ) : null}

      {draft && draft.mode !== 'menu' ? (
        <NoteEditor
          mode={draft.mode}
          quote={quote}
          style={draft.style}
          color={draft.color}
          note={draft.note}
          updatedAt={draft.mode === 'edit' ? editing?.updatedAt : undefined}
          orphaned={draft.mode === 'edit' ? editing?.orphaned === true : false}
          onStyleChange={(style) => patchDraft({ style })}
          onColorChange={(color) => patchDraft({ color })}
          onNoteChange={(note) => patchDraft({ note })}
          onSave={handleSave}
          onDelete={draft.mode === 'edit' ? handleDelete : undefined}
          onClose={() => setDraft(null)}
        />
      ) : null}

      <NoteList
        open={listOpen}
        notes={notes}
        storageError={storageError}
        onClose={() => onListOpenChange(false)}
        onLocate={locate}
        onEdit={openEditor}
        onColorChange={(id, color) => update(id, { color })}
        onDelete={remove}
      />

      {toast ? (
        <div
          data-note-ui=""
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-[12.5px] text-[var(--text)] shadow-[var(--shadow)]"
        >
          {toast}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
