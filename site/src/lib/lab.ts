/**
 * 互动原理实验室的通用类型与地址工具。
 *
 * 每个轨道可以有一套自包含的图解页（public/<baseDir>/*.html），
 * 由 LabPage 统一渲染：左侧章节导航 + 右侧 iframe。
 */

export interface LabChapter {
  /** URL 片段，如 /middleware/lab/01-message-journey */
  id: string;
  /** public/<baseDir>/ 下的文件名 */
  file: string;
  /** 章节标题 */
  title: string;
  /** 一句话原理 */
  principle: string;
  /** 对应文章路由（站内 SPA 路由，直接 <Link> 可达） */
  articleRoute: string;
  articleTitle: string;
}

export interface LabConfig {
  trackId: string;
  title: string;
  subtitle: string;
  /** 实验室根路由 */
  route: string;
  /** public/ 下的目录名，如 agent-lab、middleware-lab */
  baseDir: string;
  chapters: readonly LabChapter[];
}

/** 章节 HTML 的站内地址（自动适配 Vercel base=/ 与 GitHub Pages base=/learning-hub/） */
export function labChapterUrl(baseDir: string, file: string): string {
  // import.meta.env 由 Vite 在构建期替换；tsx 直跑（冒烟脚本）时它为 undefined，
  // 用 ?? 兜底成 '/'，两种环境都能给出正确地址。
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${baseDir}/${file}`;
}
