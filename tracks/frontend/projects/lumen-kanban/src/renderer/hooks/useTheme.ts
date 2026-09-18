import { useEffect } from 'react';
import { useUiStore, type ThemeMode } from '@/store/ui';

const resolve = (mode: ThemeMode): 'light' | 'dark' => {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * 把 store 里的 theme 落到 <html data-theme="...">。
 *
 * 为什么用 data-theme 而不是给 body 加 class：
 * Tailwind v4 默认的 dark: 变体走 prefers-color-scheme（只能跟随系统），
 * 我们想支持"系统 / 亮 / 暗"三态，所以用 @custom-variant 改写成 data-theme 匹配。
 */
export function useThemeEffect(): void {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      root.dataset.theme = resolve(theme);
    };

    apply();

    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
