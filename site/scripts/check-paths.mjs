#!/usr/bin/env node
/**
 * 检查仓库里是否混入了本机绝对路径。
 *
 * 用法：node scripts/check-paths.mjs <仓库根>
 * 退出码：0 干净，1 命中。
 *
 * 为什么不用 grep：规则文档里必然要举「错误写法」的反例，
 * 纯 grep 会把反例也判成泄露。这里支持行级豁免——
 * 某一行确实是示例时，在同一行或它的上一行写 lh-allow-abs-path 即可放行。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ALLOW_MARKER = 'lh-allow-abs-path';

const ROOT = resolve(process.argv[2] ?? '.');

const EXTS = new Set(['.md', '.ts', '.tsx', '.json']);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'coverage',
  '.workbuddy',
  '.cache',
]);

// 生成物目录：内容是从 tracks/ 复制出来的，命中的话源头上也会命中，不必重复报
const SKIP_REL_PREFIXES = ['site/public/content'];

const RULES = [
  {
    name: 'Windows 开发盘路径',
    re: /[a-z]:\\code(?:[\\/]|$)/i,
    hint: 'D:\\code\\... 这类路径只对作者本机有意义',
  },
  {
    name: 'Git Bash 风格路径',
    re: /\/[a-z]\/code(?:[\\/]|$)/i,
    hint: '/d/code/... 与上一条等价，只是写法不同',
  },
  {
    name: '指向本仓库的绝对目录',
    // 盘符必须独立出现，否则 https:// 里的 "s:/" 会被当成 C: 这种盘符
    re: /(?:^|[^\w\\/])(?:[a-z]:[\\/]|\/(?:Users|home|mnt)\/)[^\s"'`]*learning-hub\b/i,
    hint: '凡是带仓库文件夹名 learning-hub 的绝对路径，都说明路径没相对化',
  },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 无权限或已删除，跳过
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_REL_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      walk(full, out);
      continue;
    }
    if (entry.isFile() && EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      out.push({ full, rel });
    }
  }
  return out;
}

function scanLine(line) {
  for (const rule of RULES) {
    const hit = line.match(rule.re);
    if (hit) return { rule, text: hit[0].trim() };
  }
  return null;
}

const files = walk(ROOT);
const hits = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file.full, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const found = scanLine(line);
    if (!found) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    if (line.includes(ALLOW_MARKER) || prev.includes(ALLOW_MARKER)) continue;
    hits.push({ file: file.rel, line: i + 1, ...found });
  }
}

if (hits.length === 0) {
  console.log(`绝对路径检查通过：已扫描 ${files.length} 个文件`);
  process.exit(0);
}

for (const hit of hits) {
  const where = `${hit.file}:${hit.line}`;
  const msg = `${where} 命中「${hit.rule.name}」：${hit.text} —— ${hit.rule.hint}`;
  console.log(`::error file=${hit.file},line=${hit.line}::${msg}`);
  console.log(msg);
}

console.error(
  `\n发现 ${hits.length} 处本机绝对路径，请改为相对仓库根的路径。` +
    `\n确属示例时，在该行或上一行加 ${ALLOW_MARKER} 注释放行。`,
);
process.exit(1);
