/** 拼接 class，过滤掉 falsy 值 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 把 ISO 时间格式化为 `YYYY-MM-DD`，非法输入返回 null 由调用方决定兜底 */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 时间戳格式化为 `YYYY-MM-DD HH:mm`，用于笔记的创建/更新时间 */
export function formatDateTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 大数字缩写：12345 -> 1.2w */
export function formatCount(value: number): string {
  if (value < 10000) return String(value);
  return `${(value / 10000).toFixed(1)}w`;
}

/** 去标签后的纯文本截断，用于 SEO 描述与卡片摘要兜底 */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
