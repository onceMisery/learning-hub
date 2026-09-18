import { marked } from 'marked';
import type { Block, Heading, Inline, LangTabItem, ListItem } from '../../src/types/content';
import { highlightCode } from './shiki';

/**
 * Markdown → 结构化块。
 *
 * 之所以不直接输出 HTML 字符串，有两个原因：
 * 1. 本仓库接受外部 PR，必须避免 `dangerouslySetInnerHTML` 带来的 XSS 面；
 * 2. 需要在正文中插入 `<SourceRef>` / `<Callout>` 等 React 组件，结构化块更好处理。
 *
 * marked 的 token 结构在不同小版本间会有微调，这里刻意只依赖「最小可用形状」，
 * 通过显式断言读取字段，避免升级依赖时类型大改导致构建失败。
 */

interface RawToken {
  type: string;
  [key: string]: unknown;
}

type TokensOf = RawToken[];

function asTokens(value: unknown): TokensOf {
  return Array.isArray(value) ? (value as TokensOf) : [];
}
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* 自定义组件占位符                                                     */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE = /^@@LHBLOCK:(\d+)@@$/;
/** 开标签：`<SourceRef ... />` 自闭合，`<Callout ...>` / `<LangTabs ...>` 成对出现 */
const CUSTOM_OPEN_RE = /^\s*<(SourceRef|Callout|LangTabs)(?:\s+([^>]*?))?\/?>\s*$/;
const CUSTOM_CLOSE_RE = /^\s*<\/(Callout|LangTabs)>\s*$/;
/**
 * 单行成对写法：`<Callout …>正文</Callout>` 全挤在一行。
 * 这种写法很自然（短提示块没必要拆三行），若只认多行形式，
 * 整行会被当成普通段落、把原始标签原文显示到页面上，所以必须支持。
 */
const CUSTOM_INLINE_RE = /^\s*<(Callout|LangTabs)(?:\s+([^>]*?))?>([\s\S]*?)<\/\1>\s*$/;

type CustomKind = 'sourceRef' | 'callout' | 'langTabs';

interface PendingBlock {
  kind: CustomKind;
  attrs: Record<string, string>;
  /** 成对标签的正文（原始 markdown） */
  body?: string;
}

/**
 * 语言标识 → 标签显示名。
 *
 * 只影响按钮上的文字，不影响高亮（高亮仍按原始 info 交给 Shiki），
 * 所以这里没收录的语言会退回「首字母大写」的兜底，不会出错。
 */
const LANG_LABELS: Record<string, string> = {
  java: 'Java',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  javascript: 'JavaScript',
  rust: 'Rust',
  rs: 'Rust',
  go: 'Go',
  golang: 'Go',
  python: 'Python',
  py: 'Python',
  kotlin: 'Kotlin',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  css: 'CSS',
  html: 'HTML',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  sql: 'SQL',
  text: 'Text',
};

function langLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return 'Text';
  return LANG_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** 解析 `<LangTabs>` 正文：按出现顺序收集代码围栏，逐个在构建期高亮 */
async function buildLangTabs(body: string): Promise<LangTabItem[]> {
  const tokens = marked.lexer(body) as unknown as TokensOf;
  const items: LangTabItem[] = [];
  for (const token of tokens) {
    if (token.type !== 'code') continue;
    const info = (asString(token.lang).split(/\s+/)[0] ?? '').trim();
    const code = asString(token.text).replace(/\n$/, '');
    const { html, lang } = await highlightCode(code, info);
    items.push({
      lang,
      label: langLabel(info),
      code,
      html,
      lines: code.length === 0 ? 0 : code.split('\n').length,
    });
  }
  return items;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/**
 * 把 `<SourceRef .../>`、`<Callout ...>...</Callout>` 与
 * `<LangTabs ...>...</LangTabs>` 从源码中摘出来，
 * 替换成一个绝不会与正文冲突的纯文本占位符。
 * 之后在 token 流里遇到「整段就是一个占位符」的段落时，再还原成组件块。
 */
function extractCustomBlocks(src: string): { src: string; pending: PendingBlock[] } {
  const pending: PendingBlock[] = [];
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let collecting: { kind: 'callout' | 'langTabs'; attrs: Record<string, string>; body: string[] } | null = null;
  /** 当前是否处在代码围栏内部（记录围栏标记，如 ``` 或 ````） */
  let fence: string | null = null;

  const pushPlaceholder = (block: PendingBlock): string => {
    const index = pending.length;
    pending.push(block);
    return `@@LHBLOCK:${index}@@`;
  };

  for (const line of lines) {
    if (collecting) {
      const close = CUSTOM_CLOSE_RE.exec(line);
      if (close && close[1] === (collecting.kind === 'callout' ? 'Callout' : 'LangTabs')) {
        out.push(
          pushPlaceholder({
            kind: collecting.kind,
            attrs: collecting.attrs,
            body: collecting.body.join('\n'),
          }),
        );
        collecting = null;
      } else {
        collecting.body.push(line);
      }
      continue;
    }

    // 代码围栏内的内容原样保留：文档里演示自定义块语法时不能被当真解析
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] as string;
      if (fence === null) fence = marker[0] === '`' ? '`'.repeat(marker.length) : '~'.repeat(marker.length);
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }

    const open = CUSTOM_OPEN_RE.exec(line);
    if (open) {
      const tag = open[1];
      const attrs = parseAttrs(open[2] ?? '');
      if (tag === 'SourceRef') {
        out.push(pushPlaceholder({ kind: 'sourceRef', attrs }));
      } else {
        collecting = { kind: tag === 'LangTabs' ? 'langTabs' : 'callout', attrs, body: [] };
      }
      continue;
    }

    // 单行成对写法：开闭标签在同一行，直接整块摘走
    const inline = CUSTOM_INLINE_RE.exec(line);
    if (inline) {
      const tag = inline[1] as 'Callout' | 'LangTabs';
      out.push(
        pushPlaceholder({
          kind: tag === 'LangTabs' ? 'langTabs' : 'callout',
          attrs: parseAttrs(inline[2] ?? ''),
          body: inline[3] ?? '',
        }),
      );
      continue;
    }

    out.push(line);
  }

  // 未闭合的成对标签：不丢弃内容，降级为普通块，避免静默吞掉正文
  if (collecting) {
    out.push(...collecting.body);
  }

  return { src: out.join('\n'), pending };
}

/* ------------------------------------------------------------------ */
/* 行内节点                                                            */
/* ------------------------------------------------------------------ */

export interface MarkdownContext {
  /** 重写站内链接，返回最终 href；返回 null 表示保留原样 */
  resolveLink: (href: string) => string;
  /** 重写图片地址 */
  resolveImage: (src: string) => string;
}

function toInline(tokens: TokensOf, ctx: MarkdownContext): Inline[] {
  const result: Inline[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const value = asString(token.raw ?? token.text);
        if (value) result.push({ type: 'text', value });
        break;
      }
      case 'escape': {
        // 转义符节点：raw 是 `\*`，text 才是真正应显示的 `*`
        const value = asString(token.text);
        if (value) result.push({ type: 'text', value });
        break;
      }
      case 'html': {
        const value = asString(token.raw);
        if (value) result.push({ type: 'raw', value });
        break;
      }
      case 'strong':
        result.push({ type: 'strong', children: toInline(asTokens(token.tokens), ctx) });
        break;
      case 'em':
        result.push({ type: 'em', children: toInline(asTokens(token.tokens), ctx) });
        break;
      case 'del':
        result.push({ type: 'del', children: toInline(asTokens(token.tokens), ctx) });
        break;
      case 'codespan': {
        const value = asString(token.text).replace(/^`|`$/g, '');
        result.push({ type: 'code', value });
        break;
      }
      case 'br':
        result.push({ type: 'break' });
        break;
      case 'link': {
        const raw = asString(token.href);
        const href = ctx.resolveLink(raw);
        result.push({
          type: 'link',
          href,
          external: /^(https?:)?\/\//.test(href) || href.startsWith('mailto:'),
          children: toInline(asTokens(token.tokens), ctx),
        });
        break;
      }
      case 'image': {
        const src = ctx.resolveImage(asString(token.href));
        result.push({ type: 'image', src, alt: asString(token.text) });
        break;
      }
      default: {
        // 未知行内 token：优先尝试递归其子节点，否则退回纯文本，保证不丢内容
        const nested = asTokens(token.tokens);
        if (nested.length > 0) {
          result.push(...toInline(nested, ctx));
        } else if (typeof token.raw === 'string') {
          result.push({ type: 'text', value: token.raw });
        }
      }
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* 块级节点                                                            */
/* ------------------------------------------------------------------ */

function slugifyHeading(text: string, fallbackIndex: number): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return base || `section-${fallbackIndex}`;
}

function toListItem(token: RawToken, ctx: MarkdownContext, headingIds: Map<string, number>): ListItem {
  const inline: Inline[] = [];
  const nested: Block[] = [];

  for (const child of asTokens(token.tokens)) {
    if (child.type === 'text') {
      inline.push(...toInline(asTokens(child.tokens), ctx));
    } else {
      // 复用外层计数器，避免嵌套标题 id 与顶层重复
      nested.push(...toBlocksSync([child], ctx, headingIds));
    }
  }

  const isTask = token.task === true;
  let checked: boolean | null = null;
  if (isTask) {
    checked = token.checked === true;
    // 任务列表项的文本以 "[ ] " / "[x] " 开头，去掉以免重复渲染复选框
    const first = inline[0];
    if (first && first.type === 'text') {
      first.value = first.value.replace(/^\[[ xX]\]\s*/, '');
    }
  }

  return { checked, children: inline, nested: nested.length > 0 ? nested : null };
}

function tableCellInline(cell: unknown, ctx: MarkdownContext): Inline[] {
  const tokens = asTokens((cell as RawToken | undefined)?.tokens);
  if (tokens.length > 0) return toInline(tokens, ctx);
  const text = asString((cell as RawToken | undefined)?.text);
  return text ? [{ type: 'text', value: text }] : [];
}

async function toBlocksAsync(
  tokens: TokensOf,
  ctx: MarkdownContext,
  pending: PendingBlock[],
  headingIds: Map<string, number>,
): Promise<Block[]> {
  const blocks: Block[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;

      case 'heading': {
        const raw = asString(token.text);
        const depth = Number(token.depth ?? 2);
        const plain = plainOfInline(toInline(asTokens(token.tokens), ctx));
        const base = slugifyHeading(plain || raw, blocks.length);
        const seen = headingIds.get(base) ?? 0;
        headingIds.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        blocks.push({ type: 'heading', depth, id, inline: toInline(asTokens(token.tokens), ctx) });
        break;
      }

      case 'paragraph': {
        const inline = toInline(asTokens(token.tokens), ctx);
        // 整段就是一个占位符 → 还原为自定义组件
        const only = inline.length === 1 ? inline[0] : null;
        if (only && only.type === 'text') {
          const m = PLACEHOLDER_RE.exec(only.value.trim());
          if (m) {
            const index = Number(m[1]);
            const block = pending[index];
            if (block) {
              blocks.push(await materialize(block, ctx, headingIds));
              continue;
            }
          }
        }
        // 段落里只有一个图片 → 提为图片块，便于单独做画廊样式
        if (inline.length === 1 && inline[0].type === 'image') {
          const img = inline[0];
          blocks.push({ type: 'image', src: img.src, alt: img.alt, title: '' });
          continue;
        }
        blocks.push({ type: 'paragraph', inline });
        break;
      }

      case 'code': {
        const info = asString(token.lang);
        const [langRaw, ...rest] = info.split(/\s+/);
        const code = asString(token.text).replace(/\n$/, '');
        const { html, lang } = await highlightCode(code, langRaw);
        blocks.push({
          type: 'code',
          lang,
          code,
          html,
          lines: code.length === 0 ? 0 : code.split('\n').length,
        });
        void rest; // 围栏元数据（如 title=）暂不使用，保留解析位以备扩展
        break;
      }

      case 'table': {
        const align = Array.isArray(token.align) ? (token.align as (string | null)[]) : [];
        const header = asTokens(token.header).map((c) => tableCellInline(c, ctx));
        const rows = (Array.isArray(token.rows) ? (token.rows as unknown[]) : []).map((row) =>
          (Array.isArray(row) ? (row as unknown[]) : []).map((c) => tableCellInline(c, ctx)),
        );
        blocks.push({ type: 'table', align, header, rows });
        break;
      }

      case 'list': {
        const items = asTokens(token.items).map((item) => toListItem(item, ctx, headingIds));
        blocks.push({ type: 'list', ordered: token.ordered === true, items });
        break;
      }

      case 'blockquote': {
        blocks.push({
          type: 'quote',
          blocks: await toBlocksAsync(asTokens(token.tokens), ctx, pending, headingIds),
        });
        break;
      }

      case 'hr':
        blocks.push({ type: 'divider' });
        break;

      case 'html': {
        // 原始 HTML 一律按纯文本渲染，杜绝注入
        const raw = asString(token.raw);
        if (raw.trim()) blocks.push({ type: 'paragraph', inline: [{ type: 'raw', value: raw }] });
        break;
      }

      default: {
        const nested = asTokens(token.tokens);
        if (nested.length > 0) {
          blocks.push(...(await toBlocksAsync(nested, ctx, pending, headingIds)));
        } else if (typeof token.raw === 'string' && token.raw.trim()) {
          blocks.push({ type: 'paragraph', inline: [{ type: 'text', value: token.raw }] });
        }
      }
    }
  }

  return blocks;
}

/**
 * 同步版本的块转换器，仅用于列表项内部的嵌套内容。
 * 列表项内不处理代码块高亮（html 留空）与自定义组件，避免把异步逻辑扩散到同步上下文。
 */
function toBlocksSync(tokens: TokensOf, ctx: MarkdownContext, headingIds: Map<string, number>): Block[] {
  const blocks: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const raw = asString(token.text);
        const plain = plainOfInline(toInline(asTokens(token.tokens), ctx));
        const base = slugifyHeading(plain || raw, blocks.length);
        const seen = headingIds.get(base) ?? 0;
        headingIds.set(base, seen + 1);
        blocks.push({
          type: 'heading',
          depth: Number(token.depth ?? 2),
          id: seen === 0 ? base : `${base}-${seen}`,
          inline: toInline(asTokens(token.tokens), ctx),
        });
        break;
      }
      case 'paragraph':
        blocks.push({ type: 'paragraph', inline: toInline(asTokens(token.tokens), ctx) });
        break;
      case 'code':
        blocks.push({
          type: 'code',
          lang: (asString(token.lang).split(/\s+/)[0] ?? 'text') || 'text',
          code: asString(token.text),
          html: '',
          lines: asString(token.text).split('\n').length,
        });
        break;
      case 'list':
        blocks.push({
          type: 'list',
          ordered: token.ordered === true,
          items: asTokens(token.items).map((i) => toListItem(i, ctx, headingIds)),
        });
        break;
      case 'blockquote':
        blocks.push({ type: 'quote', blocks: toBlocksSync(asTokens(token.tokens), ctx, headingIds) });
        break;
      case 'hr':
        blocks.push({ type: 'divider' });
        break;
      default:
        break;
    }
  }
  return blocks;
}

/** 把自定义组件占位符还原成真正的块 */
async function materialize(
  block: PendingBlock,
  ctx: MarkdownContext,
  headingIds: Map<string, number>,
): Promise<Block> {
  if (block.kind === 'sourceRef') {
    return {
      type: 'sourceRef',
      repo: block.attrs.repo ?? '',
      file: block.attrs.file ?? '',
      lines: block.attrs.lines ?? null,
      symbol: block.attrs.symbol ?? null,
      caption: block.attrs.caption ?? null,
      // code / html / error 由 build-content 阶段按 codeRoots 白名单解析后回填
      code: null,
      html: null,
      lang: block.attrs.lang ?? 'text',
      error: null,
    };
  }

  if (block.kind === 'langTabs') {
    return {
      type: 'langTabs',
      title: block.attrs.title ?? null,
      items: block.body ? await buildLangTabs(block.body) : [],
    };
  }

  const kindRaw = (block.attrs.kind ?? 'info').toLowerCase();
  const kind: 'info' | 'warn' | 'success' | 'danger' =
    kindRaw === 'warn' || kindRaw === 'warning'
      ? 'warn'
      : kindRaw === 'danger' || kindRaw === 'error'
        ? 'danger'
        : kindRaw === 'success' || kindRaw === 'tip'
          ? 'success'
          : 'info';

  return {
    type: 'callout',
    kind,
    title: block.attrs.title ?? '',
    blocks: block.body
      ? await toBlocksAsync(marked.lexer(block.body) as unknown as TokensOf, ctx, [], headingIds)
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

export interface ConvertResult {
  blocks: Block[];
  headings: Heading[];
  plainText: string;
  wordCount: number;
}

export async function convertMarkdown(src: string, ctx: MarkdownContext): Promise<ConvertResult> {
  const { src: cleaned, pending } = extractCustomBlocks(src);
  const headingIds = new Map<string, number>();
  const tokens = marked.lexer(cleaned, { gfm: true, breaks: false }) as unknown as TokensOf;
  const blocks = await toBlocksAsync(tokens, ctx, pending, headingIds);

  const headings: Heading[] = [];
  for (const block of blocks) {
    if (block.type === 'heading' && block.depth >= 2 && block.depth <= 3) {
      headings.push({ id: block.id, text: plainOfInline(block.inline), depth: block.depth });
    }
  }

  const plainText = blocksToPlainText(blocks);
  return { blocks, headings, plainText, wordCount: countWords(plainText) };
}

/** 从块树提取纯文本，用于搜索索引与摘要 */
export function blocksToPlainText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
          parts.push(plainOfInline(block.inline));
          break;
        case 'paragraph':
          parts.push(plainOfInline(block.inline));
          break;
        case 'code':
          parts.push(block.code);
          break;
        case 'list':
          for (const item of block.items) {
            parts.push(plainOfInline(item.children));
            if (item.nested) walk(item.nested);
          }
          break;
        case 'table':
          for (const cell of block.header) parts.push(plainOfInline(cell));
          for (const row of block.rows) for (const cell of row) parts.push(plainOfInline(cell));
          break;
        case 'quote':
          walk(block.blocks);
          break;
        case 'callout':
          parts.push(block.title);
          walk(block.blocks);
          break;
        case 'sourceRef':
          parts.push(block.caption ?? '', block.code ?? '');
          break;
        case 'langTabs':
          if (block.title) parts.push(block.title);
          for (const item of block.items) parts.push(item.label, item.code);
          break;
        case 'image':
          parts.push(block.alt);
          break;
        case 'divider':
          break;
      }
    }
  };
  walk(blocks);
  return parts.join('\n').replace(/\n{2,}/g, '\n').trim();
}

export function plainOfInline(inline: Inline[]): string {
  return inline
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'raw':
          return node.value;
        case 'code':
          return node.value;
        case 'strong':
        case 'em':
        case 'del':
        case 'link':
          return plainOfInline(node.children);
        case 'image':
          return node.alt;
        case 'break':
          return ' ';
      }
    })
    .join('');
}

/** 中英混排字数统计：CJK 按字计，拉丁文按词计 */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9_.-]+/g) ?? [])
    .length;
  return cjk + latin;
}
