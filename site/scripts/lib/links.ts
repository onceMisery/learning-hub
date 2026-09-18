import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, githubBlobUrl } from './config';

/** 需要复制到 public 的静态资源任务 */
export interface AssetTask {
  from: string;
  to: string;
}

export interface LinkResolverOptions {
  /** 当前 Markdown 的绝对路径 */
  sourceAbs: string;
  /** 轨道根目录绝对路径 */
  trackDirAbs: string;
  /** 源 Markdown 相对仓库根的路径 -> 站内路由 */
  pageByRelFile: Map<string, string>;
  /** 允许对外发布的静态资源目录（绝对路径） */
  assetRoots: string[];
  /** 资源访问前缀，例如 `/content/assets/frontend` */
  assetUrlPrefix: string;
  /** 资源落盘目录（绝对路径），例如 site/public/content/assets/frontend */
  assetOutDirAbs: string;
}

export interface LinkResolver {
  resolveLink: (href: string) => string;
  resolveImage: (src: string) => string;
  /** 无法解析的内部链接（用于 check-content 报告） */
  broken: { kind: 'link' | 'image'; raw: string; from: string }[];
  /** 待复制的资源 */
  assets: AssetTask[];
}

function isExternal(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|data:|vscode:)/i.test(href);
}

function normalizeRel(input: string): string {
  return input.split(path.sep).join('/').replace(/^\.\//, '');
}

/** 判断 child 是否位于 parent 目录内（含自身） */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 创建链接 / 图片重写器。
 *
 * 处理优先级：
 * 1. 外部链接与页内锚点原样保留；
 * 2. 指向本仓库其他 Markdown 的链接 → 改写为站内路由；
 * 3. 指向本仓库内存在的文件（如 Cargo.toml）→ 改写为 GitHub 浏览地址；
 * 4. 图片且位于白名单资源目录 → 复制到 public 并改写为站内地址；
 * 5. 其余 → 原样保留并记为断链，交给 check-content 报警。
 */
export function createLinkResolver(options: LinkResolverOptions): LinkResolver {
  const { sourceAbs, trackDirAbs, pageByRelFile, assetRoots, assetUrlPrefix, assetOutDirAbs } =
    options;
  const sourceDir = path.dirname(sourceAbs);
  const broken: LinkResolver['broken'] = [];
  const assets: AssetTask[] = [];
  const copied = new Set<string>();

  /** 去掉 `#anchor` 与 `?query`，只保留可用于磁盘定位的部分；返回 null 表示纯锚点 */
  const resolveTarget = (raw: string): { path: string; hash: string } | null => {
    if (!raw) return null;
    if (raw.startsWith('#')) return null;
    const [pathPart = '', hash = ''] = raw.split('#');
    if (!pathPart.trim()) return null;
    return { path: path.resolve(sourceDir, decodeURIComponent(pathPart)), hash };
  };

  const resolveLink = (href: string): string => {
    if (!href || isExternal(href) || href.startsWith('#')) return href;
    const target = resolveTarget(href);
    if (!target) return href;

    // 去掉锚点后文件仍不存在 → 记为断链
    if (!fs.existsSync(target.path)) {
      broken.push({ kind: 'link', raw: href, from: sourceAbs });
      return href;
    }

    if (isInside(trackDirAbs, target.path) || isInside(REPO_ROOT, target.path)) {
      const rel = normalizeRel(path.relative(REPO_ROOT, target.path));
      const route = pageByRelFile.get(rel);
      if (route) return target.hash ? `${route}#${target.hash}` : route;
      return githubBlobUrl(rel);
    }

    return href;
  };

  const resolveImage = (src: string): string => {
    if (!src || isExternal(src)) return src;
    const target = resolveTarget(src);
    if (!target || !fs.existsSync(target.path)) {
      broken.push({ kind: 'image', raw: src, from: sourceAbs });
      return src;
    }

    const allowedRoot = assetRoots.find((root) => isInside(root, target.path));
    if (allowedRoot) {
      const rel = normalizeRel(path.relative(allowedRoot, target.path));
      const url = `${assetUrlPrefix}/${rel.split('/').map(encodeURIComponent).join('/')}`;
      const to = path.join(assetOutDirAbs, rel);
      const key = to;
      if (!copied.has(key)) {
        copied.add(key);
        assets.push({ from: target.path, to });
      }
      return url;
    }

    // 不在白名单内：退化为 GitHub 地址并保留锚点，至少图片不会 404
    const rel = normalizeRel(path.relative(REPO_ROOT, target.path));
    return `${githubBlobUrl(rel)}?raw=1`;
  };

  return { resolveLink, resolveImage, broken, assets };
}
