import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 学习进度。
 *
 * 只存在 localStorage，不引入后端——开源站点默认不收集任何用户数据。
 * 存储结构有意做了版本字段，将来结构变更时可以平滑迁移。
 */

export type ProgressStatus = 'reading' | 'done';

interface ProgressRecord {
  status: ProgressStatus;
  at: number;
}

interface ProgressStore {
  version: 1;
  pages: Record<string, ProgressRecord>;
  /** 最近访问，按时间倒序 */
  recent: { id: string; at: number }[];
}

const STORAGE_KEY = 'lh-progress';
const RECENT_LIMIT = 30;

/**
 * 新建一个空存储。
 *
 * 必须是工厂函数而不是共享常量：下面所有写操作都会在读出来的对象上原地改，
 * 若各次读取返回同一个常量对象，就会出现「内容变了、引用没变」，
 * React 判定相等后跳过渲染 —— 表现为"点了标记完成但界面没反应"。
 */
function emptyStore(): ProgressStore {
  return { version: 1, pages: {}, recent: [] };
}

function read(): ProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as ProgressStore;
    if (parsed.version !== 1 || typeof parsed.pages !== 'object') return emptyStore();
    return { version: 1, pages: parsed.pages ?? {}, recent: parsed.recent ?? [] };
  } catch {
    return emptyStore();
  }
}

function write(store: ProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用时静默降级：进度丢失但不影响阅读
  }
}

/** 订阅式读写：同一浏览器多个标签页之间也能同步 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function useProgress(): {
  statusOf: (pageId: string) => ProgressStatus | null;
  setStatus: (pageId: string, status: ProgressStatus | null) => void;
  toggle: (pageId: string) => void;
  recent: { id: string; at: number }[];
  counts: { done: number; reading: number };
  reset: () => void;
} {
  const [store, setStore] = useState<ProgressStore>(() => read());

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

  const setStatus = useCallback((pageId: string, status: ProgressStatus | null) => {
    const next = read();
    if (status === null) delete next.pages[pageId];
    else next.pages[pageId] = { status, at: Date.now() };
    next.recent = [{ id: pageId, at: Date.now() }, ...next.recent.filter((r) => r.id !== pageId)].slice(
      0,
      RECENT_LIMIT,
    );
    write(next);
    emit();
    setStore(next);
  }, []);

  const toggle = useCallback(
    (pageId: string) => {
      const current = read().pages[pageId]?.status ?? null;
      setStatus(pageId, current === 'done' ? null : 'done');
    },
    [setStatus],
  );

  const reset = useCallback(() => {
    const next = emptyStore();
    write(next);
    emit();
    setStore(next);
  }, []);

  const counts = useMemo(() => {
    let done = 0;
    let reading = 0;
    for (const record of Object.values(store.pages)) {
      if (record.status === 'done') done += 1;
      else reading += 1;
    }
    return { done, reading };
  }, [store]);

  return {
    statusOf: useCallback((pageId: string) => store.pages[pageId]?.status ?? null, [store]),
    setStatus,
    toggle,
    recent: store.recent,
    counts,
    reset,
  };
}

/** 记录一次访问（不改变完成状态） */
export function markVisited(pageId: string): void {
  const next = read();
  next.recent = [{ id: pageId, at: Date.now() }, ...next.recent.filter((r) => r.id !== pageId)].slice(
    0,
    RECENT_LIMIT,
  );
  write(next);
}
