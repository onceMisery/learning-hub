import { useCallback, useEffect, useState } from 'react';
import { loadIndex } from '@/lib/content';
import type { ContentIndex } from '@/types/content';

interface State {
  index: ContentIndex | null;
  loading: boolean;
  error: Error | null;
}

/** 模块级缓存：整站只需拉一次索引，路由切换不再重复请求 */
let cached: ContentIndex | null = null;

export function useContentIndex(): State & { reload: () => void } {
  const [state, setState] = useState<State>(() => ({
    index: cached,
    loading: cached === null,
    error: null,
  }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (cached) {
      setState({ index: cached, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    loadIndex(controller.signal)
      .then((index) => {
        cached = index;
        setState({ index, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ index: null, loading: false, error: error as Error });
      });

    return () => controller.abort();
  }, [nonce]);

  const reload = useCallback(() => {
    cached = null;
    setNonce((n) => n + 1);
  }, []);

  return { ...state, reload };
}
