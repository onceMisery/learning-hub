import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 站点根目录（site/） */
export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** 仓库根目录（learning-hub/） */
export const REPO_ROOT = path.resolve(SITE_ROOT, '..');
/** 内容源目录（tracks/） */
export const TRACKS_DIR = path.join(REPO_ROOT, 'tracks');
/** 生成物输出目录，会被 .gitignore 忽略 */
export const OUTPUT_DIR = path.join(SITE_ROOT, 'public', 'content');
/** 静态资源输出目录 */
export const ASSET_DIR = path.join(OUTPUT_DIR, 'assets');

/** 参与模板扫描的目录（下划线开头的一律跳过） */
export const TEMPLATE_PREFIX = '_';

/** 仓库地址，用于「在 GitHub 编辑此页」与源码外链。可用环境变量覆盖。 */
export const REPO_URL = process.env.LH_REPO_URL ?? 'https://github.com/onceMisery/learning-hub';
/** 默认分支 */
export const REPO_BRANCH = process.env.LH_REPO_BRANCH ?? 'main';

/**
 * 代码围栏语言归一化表。
 *
 * 源文档里混用了大量别名（javascript / TypeScript / shell / sh ...），
 * 统一到 Shiki 的标准语言 id，避免高亮静默退化为纯文本。
 */
const LANG_ALIASES: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  shell: 'shellscript',
  sh: 'shellscript',
  bash: 'bash',
  console: 'shellscript',
  zsh: 'shellscript',
  powershell: 'powershell',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  go: 'go',
  golang: 'go',
  python: 'python',
  py: 'python',
  toml: 'toml',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  diff: 'diff',
  text: 'text',
  txt: 'text',
  plain: 'text',
};

/** Shiki 需要预加载的语言 */
export const SHIKI_LANGS = [
  'bash',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsonc',
  'jsx',
  'powershell',
  'python',
  'rust',
  'shellscript',
  'sql',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
];

export const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark-default' } as const;

/** 把任意围栏语言标记归一化为 Shiki 语言 id，无法识别时返回 text */
export function normalizeLang(raw: string | undefined | null): string {
  if (!raw) return 'text';
  const key = raw.trim().toLowerCase();
  if (!key) return 'text';
  return LANG_ALIASES[key] ?? (/^[a-z0-9+#-]{1,20}$/.test(key) ? key : 'text');
}

/** 生成 GitHub 上某文件的编辑地址 */
export function githubEditUrl(relativeFile: string): string {
  const p = relativeFile.split(path.sep).join('/');
  return `${REPO_URL}/edit/${REPO_BRANCH}/${encodeURI(p)}`;
}

/** 生成 GitHub 上某文件的浏览地址 */
export function githubBlobUrl(relativeFile: string): string {
  const p = relativeFile.split(path.sep).join('/');
  return `${REPO_URL}/blob/${REPO_BRANCH}/${encodeURI(p)}`;
}
