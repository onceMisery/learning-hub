/**
 * 图标集。
 *
 * 统一 24×24 视框、1.6 描边、currentColor 取色，
 * 避免引入图标库带来的体积与风格不一致问题。
 */

export type IconName =
  | 'sun'
  | 'moon'
  | 'search'
  | 'menu'
  | 'panel-left'
  | 'close'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'copy'
  | 'external'
  | 'github'
  | 'book'
  | 'layers'
  | 'clock'
  | 'arrow-right'
  | 'arrow-left'
  | 'target'
  | 'alert'
  | 'file'
  | 'sparkles'
  | 'highlight'
  | 'underline'
  | 'note'
  | 'trash'
  | 'list';

const PATHS: Record<IconName, string> = {
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.657-5.657 1.414-1.414M4.929 19.071l1.414-1.414m11.314 0 1.414 1.414M4.929 4.929 6.343 6.343M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 13.5A8.5 8.5 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5.2-1.8L21 21',
  menu: 'M4 7h16M4 12h16M4 17h16',
  // 左侧栏开关：外框 + 一条竖分隔线，收起/展开共用同一个图形
  'panel-left': 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13ZM9 4v16',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  check: 'M5 13l4 4L19 7',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  external: 'M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  github:
    'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z',
  book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Zm4 0v14',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm9 9-9 5-9-5m18 4-9 5-9-5',
  clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-14v5l3.5 2',
  'arrow-right': 'M4 12h15m-6-6 6 6-6 6',
  'arrow-left': 'M20 12H5m6-6-6 6 6 6',
  target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-4.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-3.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  alert: 'M12 9v4m0 3h.01M10.3 4.3 2.6 17.6A1.5 1.5 0 0 0 3.9 20h16.2a1.5 1.5 0 0 0 1.3-2.4L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z',
  file: 'M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z',
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Zm6 9l.8 2.2L21 15l-2.2.8L18 18l-.8-2.2L15 15l2.2-.8L18 12Z',
  // 高亮：一支笔 + 底部基线，语义是"划重点"
  highlight: 'M4 20h16M7.5 16.5 16 8a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5l-8.5 8.5H7.5v-3Z',
  // 下划线：字母 U 下面一道线
  underline: 'M7 4v6a5 5 0 0 0 10 0V4M5 20h14',
  // 笔记：纸上的笔迹
  note: 'M12 20h8M4 16.5V20h3.5L18.2 9.3a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0L4 16.5Z',
  trash: 'M4 7h16M9 7V5h6v2M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7M10.5 11v6M13.5 11v6',
  list: 'M8 6h12M8 12h12M8 18h12M4.2 6h.01M4.2 12h.01M4.2 18h.01',
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** 装饰性图标默认对读屏隐藏；语义图标请传 aria-label */
  label?: string;
}

export function Icon({ name, size = 16, className, label }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={{ flex: 'none' }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
