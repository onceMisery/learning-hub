/**
 * 划线笔记的锚点模型（纯函数，不依赖 React）。
 *
 * 要解决的问题：正文是从 `Block[]` 渲染出来的，用户划下的那一段文字
 * 必须有一个「既对得上今天的内容、又扛得住明天重新生成」的坐标。
 *
 * 坐标系设计
 * ------------------------------------------------------------------
 * 正文被切成若干「锚点单元」——能承载行内文本的最小渲染块：
 * 段落、标题、列表项的行内部分、表格单元格。
 * 单元用「路径」寻址，路径与 Markdown.tsx 的渲染顺序严格同构：
 *
 *   顶层第 3 块              `3`
 *   列表第 2 项              `3.2`
 *   列表项内的第 0 个嵌套块   `3.2.0`
 *   表格表头第 1 列           `5.h0`      第 2 行第 1 列 → `5.r2c1`
 *   引用 / 提示块内的块       与列表项内嵌套块同规则
 *
 * 路径由本文件的 childPath() 等纯函数生成，渲染与解析**共用同一份实现**，
 * 所以「写进去的坐标」和「画出来的位置」不会各说各话。
 *
 * 单元内的偏移量 = 该单元**可见文本**的字符下标。可见文本由 inlineText() 定义
 * （图片、换行不产生文本），与 DOM 的 textContent 口径一致，
 * 因此「选区 → 偏移」和「偏移 → 渲染」两侧永远对齐。
 *
 * 为什么还要存 quote
 * ------------------------------------------------------------------
 * 只存「路径 + 偏移」是不够的：内容一旦被改写，偏移就会指向别的文字。
 * 因此每条记录另外保存原文片段 quote：
 *   1. 同单元内按 quote 就近找回 → 修正偏移；
 *   2. 全文唯一命中 → 把片段搬到新单元；
 *   3. 仍然找不到 → 标记 orphaned，**保留数据**，
 *      宁可"位置失效"也绝不丢用户的笔记。
 */

import type { Block, Inline } from '@/types/content';

/* ------------------------------------------------------------------ */
/* 类型                                                               */
/* ------------------------------------------------------------------ */

/** 划线样式。刻意只保留两种：样式再多是"形状"的堆砌，颜色才该承担分类的职责 */
export type NoteStyle = 'highlight' | 'underline';

/**
 * 划线颜色。
 *
 * 五色是"能一眼分辨、又不至于需要记忆色号"的上限：再多用户就得靠猜第 6 个是什么，
 * 再少就退化成"有划线 / 没划线"两种信息量。颜色的语义交给用户自己定义
 * （重点 / 疑问 / 已掌握 / 待办…），产品侧不预设含义，因此只给色名不给标签。
 *
 * 底色与虚线的实际取值在 styles/index.css 的 `--note-*` token 里，
 * 深浅两套主题各一份 —— 同一个色名在两个主题下的 alpha 并不相同，
 * 因为纸白底上必须压得更淡才能保住文字对比度。
 */
export type NoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

/** 色板顺序 = 浮层与弹层里的排列顺序。蓝色居中是刻意的历史默认值 */
export const NOTE_COLORS: readonly NoteColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

/** 旧数据（还没有 color 字段的那批）回落到蓝色，也就是改动前的唯一颜色 */
export const DEFAULT_NOTE_COLOR: NoteColor = 'blue';

export function isNoteColor(value: unknown): value is NoteColor {
  return value === 'yellow' || value === 'green' || value === 'blue' || value === 'pink' || value === 'purple';
}

/** 选区刚解析出来、尚未落库的片段：text 是整段单元文本，落库时裁成 quote */
export interface RawSegment {
  path: string;
  /** 该锚点单元的完整可见文本 */
  text: string;
  /** 单元内字符起点（含） */
  start: number;
  /** 单元内字符终点（不含） */
  end: number;
}

/** 落库后的片段：只保留坐标与原文，不再冗余整段单元文本 */
export interface NoteSegment {
  path: string;
  start: number;
  end: number;
  quote: string;
}

/** 渲染用的标记：偏移口径与 NoteSegment 完全一致 */
export interface InlineMark {
  id: string;
  style: NoteStyle;
  color: NoteColor;
  start: number;
  end: number;
  /** 是否带文字笔记 —— 用于区分"纯划线"与"有笔记"两种视觉强度 */
  hasNote: boolean;
}

/** 锚点单元：路径 + 该单元的可见文本 */
export interface Unit {
  path: string;
  text: string;
}

/**
 * 视口坐标下的矩形。
 *
 * 只保留定位需要的 5 个字段，而不是直接用 DOMRect：
 * 一来浮层不需要 x/y/right，二来测试环境里 DOMRect 构造器不一定可用，
 * 用普通对象可以让定位逻辑在任何环境下都能被验证。
 */
export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

/** 把任意具有几何信息的对象收敛成 AnchorRect */
export function toAnchorRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}): AnchorRect {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom };
}

/* ------------------------------------------------------------------ */
/* 路径生成（渲染侧与解析侧共用）                                      */
/* ------------------------------------------------------------------ */

/** 某个块下第 index 个子块 / 子项的路径 */
export function childPath(path: string, index: number): string {
  return path ? `${path}.${index}` : `${index}`;
}

/** 表格表头单元格路径 */
export function tableHeaderPath(path: string, column: number): string {
  return `${path}.h${column}`;
}

/** 表格数据单元格路径 */
export function tableRowPath(path: string, row: number, column: number): string {
  return `${path}.r${row}c${column}`;
}

/* ------------------------------------------------------------------ */
/* 可见文本                                                           */
/* ------------------------------------------------------------------ */

/**
 * 行内节点的可见文本。
 *
 * 口径必须与 DOM 一致：图片（<img>）与换行（<br>）都不产生文字，
 * 所以这里返回空串而不是替代字符。
 */
export function inlineText(nodes: readonly Inline[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'raw':
      case 'code':
        out += node.value;
        break;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        out += inlineText(node.children);
        break;
      // image / break 不产生可见文本
      default:
        break;
    }
  }
  return out;
}

/**
 * 按渲染顺序收集整篇文档的锚点单元。
 *
 * 遍历顺序必须与 Markdown.tsx 的 BlockView 逐条对应，
 * 否则路径会错位（错位的后果是"笔记画到了别的段落上"，且不报错）。
 * 不可划线的块（代码块、提示块的标题、图片、分割线、多语言对照）直接跳过。
 */
export function collectUnits(
  blocks: readonly Block[],
  path = '',
  /**
   * 逐块标记「渲染时是否跳过」，需与样式层/渲染层用的那份完全一致
   * （见 lib/doc-structure.ts 的 redundantFlags）。
   * 渲染时不存在的块不能出现在单元列表里，否则笔记自愈会定位到画不出来的路径。
   */
  skip?: readonly boolean[],
): Unit[] {
  const units: Unit[] = [];

  blocks.forEach((block, index) => {
    if (skip?.[index]) return;
    const p = childPath(path, index);
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        units.push({ path: p, text: inlineText(block.inline) });
        break;

      case 'list':
        block.items.forEach((item, itemIndex) => {
          const itemPath = childPath(p, itemIndex);
          units.push({ path: itemPath, text: inlineText(item.children) });
          if (item.nested) units.push(...collectUnits(item.nested, itemPath));
        });
        break;

      case 'table':
        block.header.forEach((cell, column) => {
          units.push({ path: tableHeaderPath(p, column), text: inlineText(cell) });
        });
        block.rows.forEach((row, rowIndex) => {
          row.forEach((cell, column) => {
            units.push({ path: tableRowPath(p, rowIndex, column), text: inlineText(cell) });
          });
        });
        break;

      case 'quote':
      case 'callout':
        units.push(...collectUnits(block.blocks, p));
        break;

      default:
        break;
    }
  });

  return units;
}

/* ------------------------------------------------------------------ */
/* DOM → 锚点                                                         */
/* ------------------------------------------------------------------ */

/**
 * 读取某个锚点单元的可见文本。
 *
 * 单元之间不嵌套，所以正常情况就是所有文本节点顺序拼接；
 * 仍然显式跳过"属于其他单元"的文本节点，作为结构被改坏时的防线。
 */
function domText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let out = '';
  let node = walker.nextNode();
  while (node) {
    const owner = node.parentElement?.closest('[data-block-path]');
    if (owner === el) out += node.nodeValue ?? '';
    node = walker.nextNode();
  }
  return out;
}

/**
 * 把一个 Range 边界换算成「相对某个锚点单元的字符偏移」。
 *
 * 边界落在单元之外时自动夹紧：在单元之前 → 0，在单元之后 → 单元长度。
 * 这个"夹紧"恰好就是跨单元选择需要的语义，所以不必再做相交判断。
 */
function offsetWithin(el: HTMLElement, container: Node, offset: number): number {
  if (!el.contains(container)) {
    const rel = el.compareDocumentPosition(container);
    // container 在 el 之后 → 边界算作单元末尾
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return domText(el).length;
    // container 在 el 之前（或不可比）→ 边界算作单元开头
    return 0;
  }

  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(container, offset);
  if (range.collapsed) return 0;
  // toString() 的口径与 inlineText() 一致（不含图片/换行）
  return range.toString().length;
}

/**
 * 把 DOM 选区解析成一组锚点片段。
 *
 * 跨段落选择会自然产出多条片段（中间被整段覆盖的单元得到 start=0、end=len），
 * 每条片段只落在一个单元上，后续的裁剪、渲染、找回都因此变得简单。
 *
 * 首尾空白会被裁掉——用户拖选时经常会多带一个空格，
 * 把"看不见的空白"记进笔记没有意义，还会让重定位的 quote 变得脆弱。
 */
export function anchorSelection(root: HTMLElement, range: Range): RawSegment[] {
  const segments: RawSegment[] = [];
  const units = root.querySelectorAll<HTMLElement>('[data-block-path]');

  for (const el of Array.from(units)) {
    const path = el.dataset.blockPath;
    if (!path) continue;

    const text = domText(el);
    if (!text.length) continue;

    const a = offsetWithin(el, range.startContainer, range.startOffset);
    const b = offsetWithin(el, range.endContainer, range.endOffset);
    // 相等意味着选区完全落在单元之外（都在开头或都在末尾），或落在同一个点上
    if (a === b) continue;

    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const start = from + lead;
    const end = to - trail;
    if (end <= start) continue;

    segments.push({ path, text, start, end });
  }

  return segments;
}

/** 选区指纹：用于判断"这次当选区没有变化"，避免重复渲染浮层 */
export function segmentSignature(segments: readonly RawSegment[]): string {
  return segments.map((s) => `${s.path}:${s.start}-${s.end}`).join(',');
}

/** 选区原文预览（跨段用省略号连接），列表与弹层都用它 */
export function previewOf(segments: readonly RawSegment[]): string {
  return segments.map((s) => s.text.slice(s.start, s.end)).join(' … ');
}

/* ------------------------------------------------------------------ */
/* 重叠裁剪                                                           */
/* ------------------------------------------------------------------ */

/** 从区间 [s,e) 中去掉 [a,b)，返回剩余部分（0~2 段） */
function subtractInterval(s: number, e: number, a: number, b: number): [number, number][] {
  if (b <= s || a >= e) return [[s, e]];
  const parts: [number, number][] = [];
  if (a > s) parts.push([s, Math.min(a, e)]);
  if (b < e) parts.push([Math.max(b, s), e]);
  return parts;
}

/**
 * 把新选区里"已经被划过"的部分剪掉，只返回没被占用的片段。
 *
 * 这里刻意**不去修改已有笔记**：重叠是用户的正常操作（先划一句、再划整段），
 * 改已有数据才是真正会丢笔记的做法。所以策略是——
 *   完全被覆盖 → 返回空数组，调用方引导用户去编辑那条已有笔记；
 *   部分重叠   → 只划空出来的部分。
 * 由此得到一条不变量：**同一篇文档里任意两条笔记的区间互不相交**，
 * 渲染时一个字符最多只属于一条笔记，逻辑因此大幅简化。
 */
export function subtractSegments(
  incoming: readonly RawSegment[],
  existing: readonly NoteSegment[],
): NoteSegment[] {
  const out: NoteSegment[] = [];

  for (const seg of incoming) {
    let parts: [number, number][] = [[seg.start, seg.end]];
    for (const other of existing) {
      if (other.path !== seg.path) continue;
      parts = parts.flatMap(([s, e]) => subtractInterval(s, e, other.start, other.end));
      if (parts.length === 0) break;
    }

    for (const [s, e] of parts) {
      if (e <= s) continue;
      const quote = seg.text.slice(s, e);
      if (!quote.trim()) continue;
      out.push({ path: seg.path, start: s, end: e, quote });
    }
  }

  return out;
}

/** 找出与选区有交集的笔记（用于"已经划过了"时直接打开它） */
export function findOverlapping<T extends { segments: readonly NoteSegment[] }>(
  records: readonly T[],
  incoming: readonly RawSegment[],
): T | null {
  for (const record of records) {
    for (const seg of record.segments) {
      for (const raw of incoming) {
        if (raw.path !== seg.path) continue;
        if (raw.start < seg.end && raw.end > seg.start) return record;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 内容变更后的重定位                                                 */
/* ------------------------------------------------------------------ */

export interface ReconcileResult {
  /** 修正后的片段（无法定位的片段原样保留） */
  segments: NoteSegment[];
  /** 是否**全部**片段都失效 —— 此时笔记只能作为纯文本存在 */
  orphaned: boolean;
  /** 坐标是否被修正过，调用方据此决定要不要回写存储 */
  changed: boolean;
}

/** 在 text 里找出 quote 的所有出现位置，取离 prefer 最近的那个 */
function locateNearest(text: string, quote: string, prefer: number): number | null {
  if (!quote) return null;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let from = 0;
  for (;;) {
    const at = text.indexOf(quote, from);
    if (at < 0) break;
    const distance = Math.abs(at - prefer);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = at;
    }
    from = at + 1;
  }
  return best;
}

/**
 * 用当前文档的锚点单元校正一条笔记的所有片段。
 *
 * 三级降级：同位命中 → 同单元就近找回 → 全文唯一命中搬单元 → 放弃并标记失效。
 * 「全文唯一命中」要求唯一，是因为出现多次时无法判断用户当初划的是哪一个，
 * 猜错会把笔记画到无关的段落上——那比"位置失效"更糟。
 */
export function relocateSegments(
  segments: readonly NoteSegment[],
  units: readonly Unit[],
): ReconcileResult {
  const byPath = new Map(units.map((unit) => [unit.path, unit.text]));
  const resolved: NoteSegment[] = [];
  let changed = false;
  let missed = 0;

  for (const seg of segments) {
    const text = byPath.get(seg.path);

    // 1. 原位命中：内容没动，坐标照旧
    if (text !== undefined && text.slice(seg.start, seg.end) === seg.quote) {
      resolved.push(seg);
      continue;
    }

    // 2. 同单元内就近找回（段落内插入/删除了别的文字）
    if (text !== undefined) {
      const at = locateNearest(text, seg.quote, seg.start);
      if (at !== null) {
        resolved.push({ path: seg.path, start: at, end: at + seg.quote.length, quote: seg.quote });
        changed = true;
        continue;
      }
    }

    // 3. 全文唯一命中（段落被移动、或被拆到了别的块）
    const hits = units.filter((unit) => unit.text.includes(seg.quote));
    if (hits.length === 1) {
      const hit = hits[0];
      const at = hit.text.indexOf(seg.quote);
      resolved.push({ path: hit.path, start: at, end: at + seg.quote.length, quote: seg.quote });
      changed = true;
      continue;
    }

    // 4. 找不回来：原样保留，数据不丢
    resolved.push(seg);
    missed += 1;
  }

  return {
    segments: resolved,
    orphaned: segments.length > 0 && missed === segments.length,
    changed,
  };
}
