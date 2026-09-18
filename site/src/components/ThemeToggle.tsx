import { Icon } from './Icon';
import { useTheme } from '@/lib/theme';

/** 主题切换：图标随状态淡入淡出，不做位移（高频操作） */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? '浅色' : '深色';
  return (
    <button
      type="button"
      className="lh-btn !h-8 !w-8 !px-0"
      onClick={toggle}
      aria-label={`切换到${next}模式`}
      title={`切换到${next}模式`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
    </button>
  );
}
