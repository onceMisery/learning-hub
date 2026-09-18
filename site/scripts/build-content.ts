import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ASSET_DIR, OUTPUT_DIR, REPO_ROOT, REPO_URL, SITE_ROOT } from './lib/config';
import { createLinkResolver, type AssetTask } from './lib/links';
import { convertMarkdown, type MarkdownContext } from './lib/markdown';
import { loadTracks, planPages, validateTracks, type LoadedTrack, type PlanIssue, type PlannedPage } from './lib/plan';
import { resolveSourceRef } from './lib/source-ref';
import { highlightCode } from './lib/shiki';
import type {
  Block,
  ContentIndex,
  Heading,
  PageDocument,
  PageMeta,
  SearchDoc,
  SectionMeta,
  TrackMeta,
} from '../src/types/content';

const execFileAsync = promisify(execFile);

/** 生成结果报告，供 check-content 与 CI 消费 */
interface BuildReport {
  generatedAt: string;
  pages: number;
  words: number;
  codeBlocks: number;
  brokenLinks: { kind: string; raw: string; from: string; pageId: string | null }[];
  issues: PlanIssue[];
}

const issues: PlanIssue[] = [];
const brokenLinks: BuildReport['brokenLinks'] = [];
const assetTasks: AssetTask[] = [];

let gitAvailable = false;

/**
 * 原子写文件：先写同目录的临时文件，再 rename 覆盖。
 *
 * 直接用 `writeFile` 是「先清空再写入」，文件在几毫秒内是空的/半截的。
 * 如果此时有 dev / preview 服务在跑，浏览器正好读到那一瞬间，
 * 页面就会报「内容格式非法」——这个现象很容易被误判成代码 bug。
 * 同目录 rename 是原子的（Windows 上走 MoveFileEx + REPLACE_EXISTING），
 * 读者要么看到旧内容要么看到新内容，不存在中间态。
 */
async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file);
}

/** 清掉上一次构建中途失败留下的临时文件，避免它们被当成内容一起发出去 */
async function sweepTempFiles(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sweepTempFiles(full);
    else if (entry.name.endsWith('.tmp')) await fsp.rm(full, { force: true });
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  await sweepTempFiles(OUTPUT_DIR);

  const tracks = loadTracks(issues);
  validateTracks(tracks, issues);

  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    printIssues(issues);
    throw new Error(`轨道配置存在 ${errors.length} 个错误，已中止生成`);
  }

  const planned = planPages(tracks, issues);
  gitAvailable = await detectGit();

  // 源文件相对路径 -> 站内路由（拆分页指向第一部分）
  const pageByRelFile = new Map<string, string>();
  for (const page of planned) {
    if (!pageByRelFile.has(page.sourceRel)) pageByRelFile.set(page.sourceRel, page.route);
  }

  const trackById = new Map(tracks.map((t) => [t.config.id, t]));

  // 输出目录整体重建，保证幂等（不会残留上一次的页面）
  await fsp.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(OUTPUT_DIR, 'pages'), { recursive: true });
  await fsp.mkdir(ASSET_DIR, { recursive: true });

  const indexPages: Record<string, PageMeta> = {};
  const searchDocs: SearchDoc[] = [];
  const sectionPages = new Map<string, PageMeta[]>();
  let totalWords = 0;
  let totalCodeBlocks = 0;

  // 同一轨道内按阅读顺序串联上下篇
  const byTrack = new Map<string, PlannedPage[]>();
  for (const page of planned) {
    const list = byTrack.get(page.trackId) ?? [];
    list.push(page);
    byTrack.set(page.trackId, list);
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.trackOrder - b.trackOrder);

  for (const page of planned) {
    const track = trackById.get(page.trackId);
    if (!track) continue;

    const raw =
      page.bodyOverride ??
      (await fsp.readFile(page.sourceAbs, 'utf8'));

    const assetRoots = (track.config.assets ?? []).map((a) => path.resolve(track.dirAbs, a));
    const assetUrlPrefix = `/content/assets/${page.trackId}`;
    const assetOutDirAbs = path.join(ASSET_DIR, page.trackId);

    const resolver = createLinkResolver({
      sourceAbs: page.sourceAbs,
      trackDirAbs: track.dirAbs,
      pageByRelFile,
      assetRoots,
      assetUrlPrefix,
      assetOutDirAbs,
    });

    const ctx: MarkdownContext = {
      resolveLink: resolver.resolveLink,
      resolveImage: resolver.resolveImage,
    };

    const { blocks, headings, plainText, wordCount } = await convertMarkdown(raw, ctx);
    assetTasks.push(...resolver.assets);
    for (const item of resolver.broken) {
      brokenLinks.push({ ...item, pageId: page.id });
    }

    const codeBlockCount = countCodeBlocks(blocks);
    totalCodeBlocks += codeBlockCount;

    // 解析自定义 <SourceRef>：按 codeRoots 白名单读取真实源码并高亮
    for (const block of blocks) {
      if (block.type !== 'sourceRef') continue;
      const result = await resolveSourceRef(track.dirAbs, track.config.codeRoots ?? [], {
        file: block.file,
        lines: block.lines,
        symbol: block.symbol,
      });
      block.code = result.code;
      block.lang = result.lang || block.lang;
      block.error = result.error;
      // 源码在构建期就高亮好，浏览器侧零成本
      block.html = result.code ? (await highlightCode(result.code, block.lang)).html : null;
      if (result.error) {
        // 记录为警告而不是中断构建：单个引用失效不应拖垮整站
        issues.push({ level: 'warn', message: `${result.error}（页面：${page.id}）` });
      }
    }

    const siblings = byTrack.get(page.trackId) ?? [];
    const position = siblings.findIndex((p) => p.id === page.id);
    const prev = position > 0 ? siblings[position - 1] : null;
    const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null;

    const updatedAt = gitAvailable ? await gitLastModified(page.sourceRel) : null;

    const meta: PageMeta = {
      id: page.id,
      trackId: page.trackId,
      sectionId: page.section.id,
      slug: page.slug,
      route: page.route,
      title: page.title,
      sourceFile: page.sourceRel,
      tags: page.tags,
      order: page.order,
      part: page.part ?? undefined,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
      headings,
      excerpt: makeExcerpt(plainText, page.title),
      wordCount,
      readingMinutes: Math.max(1, Math.round(wordCount / 350)),
      updatedAt,
    };

    indexPages[meta.id] = meta;
    totalWords += wordCount;

    const list = sectionPages.get(`${page.trackId}/${page.section.id}`) ?? [];
    list.push(meta);
    sectionPages.set(`${page.trackId}/${page.section.id}`, list);

    const doc: PageDocument = {
      meta,
      blocks,
      track: {
        id: track.config.id,
        title: track.config.title,
        accent: track.config.accent ?? 'teal',
        status: track.config.status ?? 'active',
      },
      section: { id: page.section.id, title: page.section.title },
    };

    await writeAtomic(
      path.join(OUTPUT_DIR, 'pages', `${page.id.replace(/\//g, '__')}.json`),
      JSON.stringify(doc),
    );

    searchDocs.push({
      id: meta.id,
      route: meta.route,
      title: meta.title,
      trackId: meta.trackId,
      trackTitle: track.config.title,
      sectionTitle: page.section.title,
      headings: headings.map((h: Heading) => h.text),
      text: plainText.slice(0, 20000),
    });
  }

  const trackMetas: TrackMeta[] = tracks
    .map((track) => toTrackMeta(track, sectionPages))
    .sort((a, b) => a.order - b.order);

  const index: ContentIndex = {
    generatedAt: new Date().toISOString(),
    repoUrl: REPO_URL,
    tracks: trackMetas,
    pages: indexPages,
    tags: buildTags(indexPages),
    stats: {
      tracks: trackMetas.length,
      pages: planned.length,
      words: totalWords,
      codeBlocks: totalCodeBlocks,
    },
  };

  await writeAtomic(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index));
  await writeAtomic(path.join(OUTPUT_DIR, 'search.json'), JSON.stringify(searchDocs));

  await copyAssets(assetTasks);

  const report: BuildReport = {
    generatedAt: index.generatedAt,
    pages: planned.length,
    words: totalWords,
    codeBlocks: totalCodeBlocks,
    brokenLinks,
    issues,
  };
  await writeAtomic(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await writeRedirects(index);

  printIssues(issues);
  console.log(
    `✓ 内容生成完成：${planned.length} 篇 · ${totalWords} 字 · ${totalCodeBlocks} 个代码块 · ${Date.now() - startedAt}ms`,
  );
  if (brokenLinks.length > 0) {
    console.warn(`⚠ 发现 ${brokenLinks.length} 个无法解析的内部链接，详见 public/content/report.json`);
  }
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function toTrackMeta(track: LoadedTrack, sectionPages: Map<string, PageMeta[]>): TrackMeta {
  const config = track.config;
  const sections: SectionMeta[] = [...config.sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((section) => {
      const pages = (sectionPages.get(`${config.id}/${section.id}`) ?? [])
        .slice()
        .sort((a, b) => a.order - b.order);
      return {
        id: section.id,
        title: section.title,
        order: section.order ?? 0,
        pages,
        projectName: section.projectName,
        standalone: section.standalone,
        projectRoot: section.projectRoot,
      };
    });

  return {
    id: config.id,
    title: config.title,
    subtitle: config.subtitle ?? '',
    order: config.order ?? 100,
    status: config.status ?? 'active',
    accent: config.accent ?? 'teal',
    tags: config.tags ?? [],
    toolchain: config.toolchain ?? '',
    verifiedAt: config.verifiedAt ?? '',
    outline: config.outline ?? [],
    sections,
    codeRoots: config.codeRoots ?? [],
  };
}

function buildTags(pages: Record<string, PageMeta>): { name: string; pageIds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const page of Object.values(pages)) {
    for (const tag of page.tags) {
      const list = map.get(tag) ?? [];
      list.push(page.id);
      map.set(tag, list);
    }
  }
  return [...map.entries()]
    .map(([name, pageIds]) => ({ name, pageIds }))
    .sort((a, b) => b.pageIds.length - a.pageIds.length || a.name.localeCompare(b.name));
}

function countCodeBlocks(blocks: Block[]): number {
  let count = 0;
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'code') count += 1;
      else if (block.type === 'langTabs') count += block.items.length;
      else if (block.type === 'quote') walk(block.blocks);
      else if (block.type === 'callout') walk(block.blocks);
      else if (block.type === 'list') {
        for (const item of block.items) if (item.nested) walk(item.nested);
      }
    }
  };
  walk(blocks);
  return count;
}

/** 生成摘要：跳过首个标题行，取正文前 140 字 */
function makeExcerpt(plainText: string, title: string): string {
  const lines = plainText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== title.trim());
  const text = lines.join(' ').replace(/\s{2,}/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

async function copyAssets(tasks: AssetTask[]): Promise<void> {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.to)) continue;
    seen.add(task.to);
    await fsp.mkdir(path.dirname(task.to), { recursive: true });
    await fsp.copyFile(task.from, task.to);
  }
}

/**
 * 输出重定向表。
 * slug 发布后即冻结，若将来必须改名，在 track.json 同级维护 redirects 即可，
 * 这里负责把它落到静态托管平台认识的格式上。
 */
async function writeRedirects(index: ContentIndex): Promise<void> {
  const lines = [
    '# 本文件由 scripts/build-content.ts 生成，请勿手改。',
    '# slug 一经发布即冻结；确需改名时在此登记旧地址到新地址的 301 跳转。',
    '',
  ];
  for (const track of index.tracks) {
    for (const section of track.sections) {
      for (const page of section.pages) {
        lines.push(`# ${page.route}  <-- ${page.sourceFile}`);
      }
    }
  }
  await fsp.mkdir(path.join(SITE_ROOT, 'public'), { recursive: true });
  await fsp.writeFile(path.join(SITE_ROOT, 'public', '_redirects'), `${lines.join('\n')}\n`, 'utf8');
}

async function detectGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', REPO_ROOT, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/** 取文件最后一次提交时间；仓库尚未初始化 git 时返回 null */
async function gitLastModified(rel: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', REPO_ROOT, 'log', '-1', '--format=%cI', '--', rel]);
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

function printIssues(list: PlanIssue[]): void {
  for (const issue of list) {
    const prefix = issue.level === 'error' ? '✗' : '⚠';
    console.log(`${prefix} ${issue.message}${issue.at ? ` (${issue.at})` : ''}`);
  }
}

main().catch((error: unknown) => {
  console.error('\n内容生成失败：');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
