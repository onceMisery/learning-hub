import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lh-theme';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

/**
 * 主题状态。
 *
 * 首屏主题由 index.html 的内联脚本同步写入 <html data-theme>，避免闪白；
 * 这里只负责后续切换，并在切换瞬间给 body 加一个短暂 class 关掉过渡，
 * 否则整站颜色会一起渐变，观感很脏。
 */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  const setTheme = useCallback((next: Theme) => {
    document.body.classList.add('lh-theme-switching');
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略即可
    }
    setThemeState(next);
    window.setTimeout(() => document.body.classList.remove('lh-theme-switching'), 60);
  }, []);

  const toggle = useCallback(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  }, [setTheme]);

  // 用户没有显式选择过主题时，跟随系统
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'light' || stored === 'dark') return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (event: MediaQueryListEvent): void => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        /* ignore */
      }
      document.documentElement.setAttribute('data-theme', event.matches ? 'light' : 'dark');
      setThemeState(event.matches ? 'light' : 'dark');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return { theme, toggle, setTheme };
}
