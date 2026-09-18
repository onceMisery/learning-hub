import type { ContentIndex, PageDocument, SearchDoc } from '@/types/content';

/**
 * 内容加载层。
 *
 * 生成物位于 `public/content/`，由 `scripts/build-content.ts` 产出：
 *  - index.json   站点索引（首屏必需，体积小）
 *  - pages/*.json 单页正文（按需懒加载）
 *  - search.json  搜索语料（首次打开搜索面板时才拉）
 *
 * 之所以不走打包期静态导入：内容属于运行时数据且目录以点开头，
 * 交给静态托管按文件分发更省事，也能让首屏 JS 保持很小。
 */

// 用可选链读取，避免在测试环境（非 Vite）下访问 import.meta.env 直接抛错
const BASE = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const ROOT = `${BASE.endsWith('/') ? BASE : `${BASE}/`}content/`;

const indexCache: { value: ContentIndex | null } = { value: null };
const pageCache = new Map<string, PageDocument>();
const inflight = new Map<string, Promise<unknown>>();
let searchCache: SearchDoc[] | null = null;

/** 统一的请求失败类型，便于 UI 区分「网络错误」与「内容缺失」 */
export class ContentError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

/** 撞上构建窗口时的重试间隔：内容重建通常几秒，一次退避足够 */
const RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析响应正文，并把「拿到的不是 JSON」这件事说清楚。
 *
 * 最常见的两种状态都不是代码故障，而是内容正在被重新生成：
 *  - 文件缺失 / 路径未命中 → 静态服务回退到 index.html，拿到一整页 HTML；
 *  - 文件正好写到一半 → 拿到半截 JSON。
 * 直接甩一句「内容格式非法」会让人以为数据结构错了，所以分别给出线索。
 */
async function readJson<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const looksLikeHtml = /^\s*(<!doctype|<html)/i.test(text);
    throw new ContentError(
      looksLikeHtml
        ? `内容文件不存在，服务端返回了页面：${path}（请先执行 npm run content）`
        : `内容格式非法：${path}（只读到 ${text.length} 字节，可能正在重新生成）`,
      response.status,
    );
  }
}

async function fetchJson<T>(path: string, signal?: AbortSignal, attempt = 0): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ROOT}${path}`, { signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ContentError('无法连接内容服务，请确认已执行 npm run content');
  }
  if (!response.ok) {
    throw new ContentError(`内容加载失败（HTTP ${response.status}）：${path}`, response.status);
  }
  try {
    return await readJson<T>(response, path);
  } catch (error) {
    // 重新生成内容时文件会被整体替换，单次请求有可能正好落在窗口里。
    // 这不是真实故障，退避重试一次就能好——比让用户自己去刷新体验好得多。
    if (attempt === 0 && !signal?.aborted) {
      await sleep(RETRY_DELAY_MS);
      return fetchJson<T>(path, signal, attempt + 1);
    }
    throw error;
  }
}

/** 相同 key 的并发请求复用同一次网络调用 */
function dedupe<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = task().finally(() => inflight.delete(key));
  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

export async function loadIndex(signal?: AbortSignal): Promise<ContentIndex> {
  if (indexCache.value) return indexCache.value;
  const value = await dedupe('index', () => fetchJson<ContentIndex>('index.json', signal));
  indexCache.value = value;
  return value;
}

export async function loadPage(pageId: string, signal?: AbortSignal): Promise<PageDocument> {
  const cached = pageCache.get(pageId);
  if (cached) return cached;
  const file = `${pageId.replace(/\//g, '__')}.json`;
  const doc = await dedupe(`page:${pageId}`, () => fetchJson<PageDocument>(`pages/${file}`, signal));
  pageCache.set(pageId, doc);
  return doc;
}

export async function loadSearchDocs(signal?: AbortSignal): Promise<SearchDoc[]> {
  if (searchCache) return searchCache;
  const docs = await dedupe('search', () => fetchJson<SearchDoc[]>('search.json', signal));
  searchCache = docs;
  return docs;
}

/** 页面 id 转「在 GitHub 编辑此页」地址 */
export function editUrlFor(repoUrl: string, branch: string, sourceFile: string): string {
  return `${repoUrl}/edit/${branch}/${sourceFile.split('/').map(encodeURIComponent).join('/')}`;
}

/** 页面 id 转静态文件地址（供调试与兜底） */
export function pageJsonUrl(pageId: string): string {
  return `${ROOT}pages/${pageId.replace(/\//g, '__')}.json`;
}
