import type { SearchDoc } from '@/types/content';

/**
 * 轻量全文检索（无第三方依赖）。
 *
 * 为什么要自己写：站点以中文为主，通用的分词方案对 CJK 支持很弱，
 * 常见的 token 化检索会出现「搜『所有权』搜不到」的问题。
 * 这里采用「CJK 二元切分 + 拉丁词切分」的折中方案：
 *  - 中文按相邻两字切分（所有权 → 所有 / 有权），既能命中整词也能容错；
 *  - 英文数字按词切分，保留前缀匹配。
 */

export interface SearchOptions {
  /** 只在这些轨道内搜索 */
  trackIds?: string[];
  limit?: number;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** 命中的上下文片段 */
  snippet: string;
  /** 命中的标题（可能是页面标题，也可能是章节标题） */
  matchedIn: 'title' | 'heading' | 'body';
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

/** 把查询串切成检索词：空白分隔，超长的中文串按 2~4 字滑窗 */
export function tokenize(query: string): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const parts = raw.split(/\s+/).filter(Boolean);
  const terms: string[] = [];

  for (const part of parts) {
    if (CJK.test(part)) {
      // 中文串：≤4 字整体作为一个词，更长则切二元
      if (part.length <= 4) {
        terms.push(part);
      } else {
        for (let i = 0; i + 2 <= part.length; i += 1) terms.push(part.slice(i, i + 2));
      }
    } else {
      terms.push(part);
    }
  }
  return [...new Set(terms)].filter((t) => t.length > 0);
}

/** 统计 term 在 text 中出现的次数（按 1 次计，避免长文刷分） */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let index = haystack.indexOf(needle);
  let count = 0;
  while (index !== -1 && count < 20) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function search(docs: SearchDoc[], query: string, options: SearchOptions = {}): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const limit = options.limit ?? 20;
  const trackFilter = options.trackIds && options.trackIds.length > 0 ? new Set(options.trackIds) : null;
  const hits: SearchHit[] = [];

  for (const doc of docs) {
    if (trackFilter && !trackFilter.has(doc.trackId)) continue;

    const title = doc.title.toLowerCase();
    const headings = doc.headings.map((h) => h.toLowerCase());
    const body = doc.text.toLowerCase();

    let score = 0;
    let matchedAll = true;
    let matchedIn: SearchHit['matchedIn'] = 'body';

    for (const term of terms) {
      let best = 0;
      if (title.includes(term)) best = Math.max(best, 12);
      for (const heading of headings) {
        if (heading.includes(term)) {
          best = Math.max(best, 7);
          break;
        }
      }
      const count = occurrences(body, term);
      if (count > 0) best = Math.max(best, Math.min(1 + count * 0.6, 6));

      if (best === 0) {
        matchedAll = false;
        break;
      }
      score += best;
      if (best >= 12) matchedIn = 'title';
      else if (best >= 7 && matchedIn !== 'title') matchedIn = 'heading';
    }

    if (!matchedAll) continue;

    hits.push({ doc, score, snippet: makeSnippet(doc.text, terms), matchedIn });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, limit);
}

/** 生成命中片段：以首个命中位置为中心取 ~120 字 */
function makeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let position = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (position === -1 || index < position)) position = index;
  }
  if (position === -1) position = 0;

  const start = Math.max(0, position - 40);
  const end = Math.min(text.length, position + 120);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** 把一段文本按命中的检索词切分，供 UI 高亮渲染 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const marks: boolean[] = new Array(text.length).fill(false);

  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index !== -1) {
      for (let i = index; i < index + term.length; i += 1) marks[i] = true;
      index = lower.indexOf(term, index + term.length);
    }
  }

  const parts: HighlightPart[] = [];
  let buffer = '';
  let bufferHit = marks[0] ?? false;
  for (let i = 0; i < text.length; i += 1) {
    const hit = marks[i] ?? false;
    if (hit !== bufferHit) {
      if (buffer) parts.push({ text: buffer, hit: bufferHit });
      buffer = '';
      bufferHit = hit;
    }
    buffer += text[i];
  }
  if (buffer) parts.push({ text: buffer, hit: bufferHit });
  return parts;
}
