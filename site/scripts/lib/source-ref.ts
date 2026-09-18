import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside } from './links';

export interface SourceRefRequest {
  /** 源码文件相对轨道根目录的路径 */
  file: string;
  /** 行区间，如 `42-78` 或 `42` */
  lines: string | null;
  /** 按符号名定位，如 `pub fn append` */
  symbol: string | null;
}

export interface SourceRefResult {
  code: string | null;
  lang: string;
  /** 解析失败原因，用于在页面上给出可读提示而不是空白 */
  error: string | null;
  /** 解析后的文件相对路径（供「在仓库中查看」使用） */
  resolvedFile: string | null;
}

const EXT_LANG: Record<string, string> = {
  '.rs': 'rust',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.toml': 'toml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sh': 'shellscript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
};

function langOf(file: string): string {
  return EXT_LANG[path.extname(file).toLowerCase()] ?? 'text';
}

function parseLines(spec: string | null, total: number): { start: number; end: number } | null {
  if (!spec) return null;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(spec);
  if (!m) return null;
  const start = Math.max(1, Number(m[1]));
  const end = m[2] ? Math.min(total, Number(m[2])) : Math.min(total, start);
  if (start > total) return null;
  return { start, end: Math.max(start, end) };
}

/** 按符号名定位：找到首个匹配行后，向后延伸到下一个顶格 `}` 或最多 60 行 */
function sliceBySymbol(content: string, symbol: string): { code: string; start: number } | null {
  const all = content.split('\n');
  const startIndex = all.findIndex((line) => line.includes(symbol));
  if (startIndex < 0) return null;
  let endIndex = all.length - 1;
  for (let i = startIndex + 1; i < Math.min(all.length, startIndex + 60); i += 1) {
    if (/^\}/.test(all[i] ?? '')) {
      endIndex = i;
      break;
    }
  }
  return { code: all.slice(startIndex, endIndex + 1).join('\n'), start: startIndex + 1 };
}

/**
 * 解析 `<SourceRef>` 指向的真实源码。
 *
 * 安全约束：文件必须落在 track.json 的 `codeRoots` 白名单内，
 * 否则即使磁盘上存在也拒绝读取，避免把 node_modules、密钥文件等带进站点。
 */
export async function resolveSourceRef(
  trackDirAbs: string,
  codeRoots: string[],
  request: SourceRefRequest,
): Promise<SourceRefResult> {
  const lang = langOf(request.file);
  if (!request.file) {
    return { code: null, lang, error: '<SourceRef> 缺少 file 属性', resolvedFile: null };
  }

  const abs = path.resolve(trackDirAbs, request.file);
  const allowed = codeRoots.some((root) => isInside(path.resolve(trackDirAbs, root), abs));
  if (!allowed) {
    return {
      code: null,
      lang,
      error: `文件不在 codeRoots 白名单内：${request.file}`,
      resolvedFile: null,
    };
  }

  let content: string;
  try {
    content = await fs.readFile(abs, 'utf8');
  } catch {
    return { code: null, lang, error: `源码文件不存在：${request.file}`, resolvedFile: null };
  }

  const allLines = content.split('\n');

  if (request.symbol) {
    const hit = sliceBySymbol(content, request.symbol);
    if (!hit) {
      return {
        code: null,
        lang,
        error: `未找到符号：${request.symbol}`,
        resolvedFile: request.file,
      };
    }
    return { code: hit.code, lang, error: null, resolvedFile: request.file };
  }

  const range = parseLines(request.lines, allLines.length);
  if (request.lines && !range) {
    return {
      code: null,
      lang,
      error: `lines 格式非法或越界：${request.lines}`,
      resolvedFile: request.file,
    };
  }

  if (!range) {
    // 未指定区间时最多展示前 60 行，避免整页塞满源码
    return {
      code: allLines.slice(0, 60).join('\n'),
      lang,
      error: null,
      resolvedFile: request.file,
    };
  }

  return {
    code: allLines.slice(range.start - 1, range.end).join('\n'),
    lang,
    error: null,
    resolvedFile: request.file,
  };
}
