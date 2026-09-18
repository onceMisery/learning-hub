/**
 * 划线笔记的存储层。
 *
 * 与 progress.ts 保持同一套约定：
 *   · 只存 localStorage，不引入后端——开源站点默认不收集任何用户数据；
 *   · 带 version 字段，将来结构变更可以平滑迁移；
 *   · 模块级订阅 + storage 事件，同一浏览器多标签页自动同步。
 *
 * 在此之上额外做了两件"笔记不能丢"的事：
 *   1. 解析失败时，先把原始字符串备份到 `lh-notes:backup` 再降级为空。
 *      否则一次脏数据（比如旧版本结构）就会把整本笔记覆盖掉。
 *   2. 写入失败（配额满）时**不动**已存的值：setItem 抛错时旧值仍在，
 *      我们把失败状态暴露给 UI 提示，而不是假装保存成功。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_NOTE_COLOR,
  isNoteColor,
  relocateSegments,
  type NoteColor,
  type NoteSegment,
  type NoteStyle,
  type Unit,
} from './note-anchor';

export interface NoteRecord {
  id: string;
  /** 所属页面：`${trackId}/${sectionId}/${slug}` */
  pageId: string;
  style: NoteStyle;
  /** 划线颜色。旧数据没有这个字段，读出来时回落到 DEFAULT_NOTE_COLOR */
  color: NoteColor;
  /** 一条笔记可以覆盖多个段落，每个片段只落在一个锚点单元上 */
  segments: NoteSegment[];
  /** 文字笔记，可为空串（纯划线） */
  note: string;
  /** 原文快照：列表展示、失效提示都用它 */
  text: string;
  /** 内容变更后已无法定位到原文，但数据保留 */
  orphaned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteInput {
  pageId: string;
  style: NoteStyle;
  color: NoteColor;
  segments: NoteSegment[];
  note: string;
  text: string;
}

export interface NotePatch {
  style?: NoteStyle;
  color?: NoteColor;
  note?: string;
  segments?: NoteSegment[];
  text?: string;
}

interface NoteStore {
  version: 1;
  notes: NoteRecord[];
}

const STORAGE_KEY = 'lh-notes';
const BACKUP_KEY = 'lh-notes:backup';

/**
 * 新建一个空存储。
 *
 * 注意这里必须是**工厂函数**而不是共享常量：写操作会在读出来的对象上原地改
 * （`next.notes = [...]`），如果各次读取都返回同一个常量对象，就会出现
 * 「内容变了、对象引用没变」的情况 —— React 判定引用相等直接跳过渲染，
 * 派生数据（划线标记）也就跟着不更新。这是一个很难查的静默 bug。
 */
function emptyStore(): NoteStore {
  return { version: 1, notes: [] };
}

/* ------------------------------------------------------------------ */
/* 读写                                                               */
/* ------------------------------------------------------------------ */

/** 弱校验：字段缺失的记录直接丢弃，避免一条坏数据让整个列表渲染报错 */
function isRecord(value: unknown): value is NoteRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<NoteRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.pageId === 'string' &&
    Array.isArray(record.segments) &&
    (record.style === 'highlight' || record.style === 'underline') &&
    typeof record.createdAt === 'number'
  );
}

/** 把残缺记录补全成可用记录（旧数据没有的字段给默认值，不做丢弃） */
function normalize(record: NoteRecord): NoteRecord {
  const segments = (record.segments ?? []).filter(
    (seg): seg is NoteSegment =>
      !!seg && typeof seg.path === 'string' && typeof seg.start === 'number' && typeof seg.end === 'number',
  );
  return {
    ...record,
    segments: segments.map((seg) => ({ ...seg, quote: seg.quote ?? '' })),
    // 颜色是后加的字段：缺字段、或值不在色板里，都回落到默认色而不是丢弃整条笔记
    color: isNoteColor(record.color) ? record.color : DEFAULT_NOTE_COLOR,
    note: typeof record.note === 'string' ? record.note : '',
    text: typeof record.text === 'string' ? record.text : segments.map((seg) => seg.quote).join(' … '),
    orphaned: record.orphaned === true,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : record.createdAt,
  };
}

function read(): NoteStore {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 无痕模式等场景下 localStorage 不可用：降级为"本次会话无笔记"
    return emptyStore();
  }
  if (!raw) return emptyStore();

  try {
    const parsed = JSON.parse(raw) as Partial<NoteStore>;
    if (!parsed || !Array.isArray(parsed.notes)) throw new Error('结构不符');
    return { version: 1, notes: parsed.notes.filter(isRecord).map(normalize) };
  } catch {
    // 先备份再降级：原始数据留在 backup 里，用户仍可人工找回
    try {
      localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      // 空间不足时放弃备份，但不能因此影响阅读
    }
    return emptyStore();
  }
}

/** 写入是否成功。失败时 localStorage 里的旧值原封不动，因此不会丢数据 */
function write(store: NoteStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 订阅                                                               */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // 老浏览器兜底
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseNotesResult {
  /** 当前页的笔记，按创建时间升序（≈ 阅读顺序） */
  notes: NoteRecord[];
  add: (input: NoteInput) => NoteRecord | null;
  update: (id: string, patch: NotePatch) => void;
  remove: (id: string) => void;
  /** 写入失败（配额满 / 被禁用），UI 据此提示"仅保存在当前页面" */
  storageError: boolean;
}

export function useNotes(pageId: string | null): UseNotesResult {
  const [store, setStore] = useState<NoteStore>(() => read());
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const listener = (): void => setStore(read());
    listeners.add(listener);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /**
   * 所有写操作都走这里：读最新值 → 在**副本**上改 → 落盘 → 通知。
   *
   * 副本这一步不能省：读出来的 notes 数组可能来自缓存或尚未落盘的状态，
   * 直接原地改会让"内容变了但对象引用没变"，React 判定相等后跳过渲染，
   * 结果就是笔记存进了 localStorage，界面上却什么都没发生。
   */
  const commit = useCallback((mutate: (next: NoteStore) => void) => {
    const current = read();
    const next: NoteStore = { version: 1, notes: [...current.notes] };
    mutate(next);
    setStorageError(!write(next));
    emit();
    setStore(next);
  }, []);

  const add = useCallback(
    (input: NoteInput): NoteRecord | null => {
      if (input.segments.length === 0) return null;
      const now = Date.now();
      const record: NoteRecord = {
        id: newId(),
        pageId: input.pageId,
        style: input.style,
        color: isNoteColor(input.color) ? input.color : DEFAULT_NOTE_COLOR,
        segments: input.segments,
        note: input.note,
        text: input.text,
        orphaned: false,
        createdAt: now,
        updatedAt: now,
      };
      commit((next) => {
        next.notes = [...next.notes, record];
      });
      return record;
    },
    [commit],
  );

  const update = useCallback(
    (id: string, patch: NotePatch) => {
      commit((next) => {
        next.notes = next.notes.map((note) =>
          note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
        );
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit((next) => {
        next.notes = next.notes.filter((note) => note.id !== id);
      });
    },
    [commit],
  );

  const notes = useMemo(() => {
    if (!pageId) return [];
    return store.notes.filter((note) => note.pageId === pageId).sort((a, b) => a.createdAt - b.createdAt);
  }, [store, pageId]);

  return { notes, add, update, remove, storageError };
}

/* ------------------------------------------------------------------ */
/* 内容变更后的重定位                                                 */
/* ------------------------------------------------------------------ */

/**
 * 文档加载完成后调用：用最新的锚点单元校正本页所有笔记的坐标。
 *
 * 只在坐标真的变了（或有笔记从失效状态恢复）时回写，
 * 所以正常浏览不会产生任何写入，也就不会触发多余的渲染。
 * 注意这里**不更新 updatedAt** —— 自动校准不是用户的编辑行为。
 */
export function reconcileNotes(pageId: string, units: readonly Unit[]): void {
  const store = read();
  if (!store.notes.some((note) => note.pageId === pageId)) return;

  let changed = false;
  const notes = store.notes.map((note) => {
    if (note.pageId !== pageId) return note;
    const fixed = relocateSegments(note.segments, units);
    if (!fixed.changed && fixed.orphaned === note.orphaned) return note;
    changed = true;
    return { ...note, segments: fixed.segments, orphaned: fixed.orphaned };
  });

  if (!changed) return;
  if (write({ version: 1, notes })) emit();
}
