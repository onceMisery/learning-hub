import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, TEMPLATE_PREFIX, TRACKS_DIR } from './config';
import type { Accent, TrackStatus } from '../../src/types/content';

/** track.json 的磁盘形态（字段全部可选，由校验器补齐默认值） */
export interface PageConfig {
  file: string;
  slug: string;
  title?: string;
  tags?: string[];
  splitBy?: string;
  splitSlugs?: string[];
}

export interface SectionConfig {
  id: string;
  title: string;
  path: string;
  order?: number;
  pages: PageConfig[];
  projectName?: string;
  standalone?: boolean;
  projectRoot?: string;
}

export interface TrackConfig {
  id: string;
  title: string;
  subtitle?: string;
  order?: number;
  status?: TrackStatus;
  accent?: Accent;
  tags?: string[];
  toolchain?: string;
  verifiedAt?: string;
  outline?: string[];
  sections: SectionConfig[];
  codeRoots?: string[];
  assets?: string[];
}

export interface LoadedTrack {
  dirAbs: string;
  config: TrackConfig;
}

const VALID_STATUS: TrackStatus[] = ['active', 'wip', 'planned'];
const VALID_ACCENT: Accent[] = ['blue', 'amber', 'cyan', 'green', 'teal'];

export interface PlanIssue {
  level: 'error' | 'warn';
  message: string;
  at?: string;
}

/**
 * 扫描 tracks/ 目录，加载全部轨道配置。
 * 约定：目录名即轨道 id，下划线开头的目录（如 _template）视为模板，不参与构建。
 */
export function loadTracks(issues: PlanIssue[]): LoadedTrack[] {
  if (!fs.existsSync(TRACKS_DIR)) {
    issues.push({ level: 'error', message: `未找到内容目录：${TRACKS_DIR}` });
    return [];
  }

  const entries = fs
    .readdirSync(TRACKS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(TEMPLATE_PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tracks: LoadedTrack[] = [];
  for (const entry of entries) {
    const dirAbs = path.join(TRACKS_DIR, entry.name);
    const configPath = path.join(dirAbs, 'track.json');
    if (!fs.existsSync(configPath)) {
      issues.push({ level: 'warn', message: `目录 ${entry.name} 缺少 track.json，已跳过` });
      continue;
    }
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as TrackConfig;
      // 目录名优先，避免手改 id 造成目录与 id 不一致
      parsed.id = entry.name;
      tracks.push({ dirAbs, config: parsed });
    } catch (error) {
      issues.push({
        level: 'error',
        message: `track.json 解析失败：${(error as Error).message}`,
        at: configPath,
      });
    }
  }

  return tracks;
}

/** 校验轨道配置：补齐默认值并收集问题 */
export function validateTracks(tracks: LoadedTrack[], issues: PlanIssue[]): void {
  const seenIds = new Set<string>();

  for (const { dirAbs, config } of tracks) {
    if (!config.id || !/^[a-z0-9-]+$/.test(config.id)) {
      issues.push({ level: 'error', message: `轨道 id 非法（只允许小写字母、数字与连字符）：${config.id}` });
    }
    if (seenIds.has(config.id)) {
      issues.push({ level: 'error', message: `轨道 id 重复：${config.id}` });
    }
    seenIds.add(config.id);

    if (!config.title) {
      issues.push({ level: 'error', message: `轨道 ${config.id} 缺少 title`, at: dirAbs });
    }
    config.subtitle ??= '';
    config.order ??= 100;
    config.status ??= 'active';
    if (!VALID_STATUS.includes(config.status)) {
      issues.push({ level: 'error', message: `轨道 ${config.id} 的 status 非法：${config.status}` });
      config.status = 'planned';
    }
    config.accent ??= 'teal';
    if (!VALID_ACCENT.includes(config.accent)) {
      issues.push({ level: 'warn', message: `轨道 ${config.id} 的 accent 非法，回退为 teal：${config.accent}` });
      config.accent = 'teal';
    }
    config.tags ??= [];
    config.toolchain ??= '';
    config.verifiedAt ??= '';
    config.outline ??= [];
    config.sections ??= [];
    config.codeRoots ??= [];
    config.assets ??= [];

    // 规划中的轨道允许没有章节
    if (config.status !== 'planned' && config.sections.length === 0) {
      issues.push({ level: 'warn', message: `轨道 ${config.id} 没有任何章节` });
    }

    const sectionIds = new Set<string>();
    for (const [index, section] of config.sections.entries()) {
      if (sectionIds.has(section.id)) {
        issues.push({ level: 'error', message: `轨道 ${config.id} 的章节 id 重复：${section.id}` });
      }
      sectionIds.add(section.id);
      section.order ??= (index + 1) * 10;

      const absSectionDir = path.join(dirAbs, section.path ?? '.');
      if (!fs.existsSync(absSectionDir)) {
        issues.push({
          level: 'error',
          message: `章节目录不存在：${section.path}`,
          at: path.join(dirAbs, 'track.json'),
        });
        continue;
      }

      const slugs = new Set<string>();
      for (const page of section.pages) {
        if (!page.file || !page.slug) {
          issues.push({ level: 'error', message: `页面缺少 file 或 slug：${JSON.stringify(page)}` });
          continue;
        }
        if (slugs.has(page.slug)) {
          issues.push({ level: 'error', message: `章节 ${section.id} 内 slug 重复：${page.slug}` });
        }
        slugs.add(page.slug);

        const absFile = path.join(absSectionDir, page.file);
        if (!fs.existsSync(absFile)) {
          issues.push({ level: 'error', message: `源文件不存在：${page.file}`, at: absSectionDir });
        }
      }
    }

    for (const root of config.codeRoots) {
      if (!fs.existsSync(path.join(dirAbs, root))) {
        issues.push({ level: 'warn', message: `codeRoots 目录不存在：${root}`, at: dirAbs });
      }
    }
    for (const asset of config.assets) {
      if (!fs.existsSync(path.join(dirAbs, asset))) {
        issues.push({ level: 'warn', message: `assets 目录不存在：${asset}`, at: dirAbs });
      }
    }
  }
}

export interface PlannedPage {
  id: string;
  trackId: string;
  section: SectionConfig;
  slug: string;
  title: string;
  tags: string[];
  /** 章节内的顺序 */
  order: number;
  /** 轨道内的阅读顺序（跨章节连续） */
  trackOrder: number;
  route: string;
  sourceAbs: string;
  /** 相对仓库根的路径 */
  sourceRel: string;
  part: { index: number; total: number; label: string } | null;
  /** 拆分出的正文；未拆分时为 null，需要读整个文件 */
  bodyOverride: string | null;
}

/**
 * 把「轨道配置」展开为「待生成页面列表」。
 *
 * 此处只做路径与拆分规划，不读取正文内容，便于 check-content 快速复用。
 */
export function planPages(tracks: LoadedTrack[], issues: PlanIssue[]): PlannedPage[] {
  const planned: PlannedPage[] = [];

  for (const track of tracks) {
    const sections = [...track.config.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let trackOrder = 0;

    for (const section of sections) {
      const sectionDirAbs = path.join(track.dirAbs, section.path ?? '.');

      for (const [pageIndex, page] of section.pages.entries()) {
        const sourceAbs = path.join(sectionDirAbs, page.file);
        const sourceRel = path.relative(REPO_ROOT, sourceAbs).split(path.sep).join('/');
        const baseTitle = page.title?.trim() || stripExt(path.basename(page.file));

        if (!page.splitBy) {
          planned.push({
            id: `${track.config.id}/${section.id}/${page.slug}`,
            trackId: track.config.id,
            section,
            slug: page.slug,
            title: baseTitle,
            tags: page.tags ?? [],
            order: pageIndex,
            trackOrder: trackOrder++,
            route: `/${track.config.id}/${section.id}/${page.slug}`,
            sourceAbs,
            sourceRel,
            part: null,
            bodyOverride: null,
          });
          continue;
        }

        // 需要拆分的超长文档：先读一次，按 splitBy 切成多页
        const raw = fs.readFileSync(sourceAbs, 'utf8');
        const chunks = splitMarkdown(raw, page.splitBy);
        if (chunks.length <= 1) {
          planned.push({
            id: `${track.config.id}/${section.id}/${page.slug}`,
            trackId: track.config.id,
            section,
            slug: page.slug,
            title: baseTitle,
            tags: page.tags ?? [],
            order: pageIndex,
            trackOrder: trackOrder++,
            route: `/${track.config.id}/${section.id}/${page.slug}`,
            sourceAbs,
            sourceRel,
            part: null,
            bodyOverride: null,
          });
          continue;
        }

        chunks.forEach((chunk, index) => {
          const fallbackSlug = String(index).padStart(2, '0');
          const slug = page.splitSlugs?.[index] ?? fallbackSlug;
          const partTitle = chunk.label ? `${baseTitle} · ${chunk.label}` : `${baseTitle} (${index + 1})`;
          planned.push({
            id: `${track.config.id}/${section.id}/${slug}`,
            trackId: track.config.id,
            section,
            slug,
            title: partTitle,
            tags: page.tags ?? [],
            order: pageIndex * 1000 + index,
            trackOrder: trackOrder++,
            route: `/${track.config.id}/${section.id}/${slug}`,
            sourceAbs,
            sourceRel,
            part: { index, total: chunks.length, label: chunk.label || `第 ${index + 1} 部分` },
            bodyOverride: chunk.body,
          });
        });
      }
    }
  }

  void issues;
  return planned;
}

interface SplitChunk {
  label: string;
  body: string;
}

/**
 * 按正则把 Markdown 切成多段。
 *
 * 第一个匹配之前的「前言」（标题、目录等）会附加到第一段，
 * 这样既不会多出一个空页，也保留了原文档的总览内容。
 */
export function splitMarkdown(raw: string, splitByPattern: string): SplitChunk[] {
  let regex: RegExp;
  try {
    regex = new RegExp(splitByPattern, 'm');
  } catch {
    return [{ label: '', body: raw }];
  }

  const lines = raw.split(/\r?\n/);
  const matchIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (regex.test(line)) matchIndexes.push(index);
  });

  if (matchIndexes.length === 0) return [{ label: '', body: raw }];

  const chunks: SplitChunk[] = [];
  matchIndexes.forEach((startLine, i) => {
    const endLine = i + 1 < matchIndexes.length ? matchIndexes[i + 1] : lines.length;
    const bodyLines = lines.slice(startLine, endLine);
    const heading = bodyLines[0] ?? '';
    const label = heading.replace(/^#+\s*/, '').trim();
    // 前言只附加给第一段
    const prefix = i === 0 && startLine > 0 ? `${lines.slice(0, startLine).join('\n')}\n\n` : '';
    chunks.push({ label, body: `${prefix}${bodyLines.join('\n')}` });
  });

  return chunks;
}

function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
