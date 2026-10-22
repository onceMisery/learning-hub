/**
 * 四条轨道的互动实验室注册表。
 *
 * 实验室页自己有一个「阅读文章」的链接（LabPage 渲染），这里补的是反方向：
 * 教程页按 trackId + slug 找回自己的实验章节，给一个进实验室的入口。
 * 用站内路由（react-router 的 Link）而不是硬编码绝对路径，
 * 这样 Vercel（base=/）与 GitHub Pages（base=/learning-hub/）都能直接点过去。
 */

import { AGENT_LAB } from './agent-lab';
import { MIDDLEWARE_LAB } from './middleware-lab';
import { PARQUET_LAB } from './parquet-lab';
import { SEATA_LAB } from './seata-lab';
import type { LabChapter, LabConfig } from './lab';

const LABS: readonly LabConfig[] = [AGENT_LAB, MIDDLEWARE_LAB, PARQUET_LAB, SEATA_LAB];

export interface LabEntry {
  /** 实验室根路由，如 /agent/lab */
  route: string;
  chapter: LabChapter;
}

/** 找不到就返回 null：多数教程页还没有配套的实验章节，这是常态不是异常。 */
export function labEntryForArticle(trackId: string | undefined, slug: string | undefined): LabEntry | null {
  if (!trackId || !slug) return null;
  for (const lab of LABS) {
    if (lab.trackId !== trackId) continue;
    const chapter = lab.chapters.find((item) => item.articleRoute.endsWith(`/${slug}`));
    if (chapter) return { route: lab.route, chapter };
  }
  return null;
}
