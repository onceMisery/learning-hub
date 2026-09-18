import type { Block } from '@/types/content';
import { inlineText } from './note-anchor';

/**
 * 正文结构层面的呈现决策：哪些块在网页上属于「重复」，应当跳过渲染。
 *
 * Markdown 源文件是给人直接读的（在编辑器里打开、在仓库里浏览都要能看懂），
 * 所以它天然带着一些"给纯文本看"的惯例：文件开头先写一遍文档标题、
 * 章节之间画一条 `---` 当分隔。但网页上：
 *   · 页面头部已经用更大的字号显示了文档标题，正文再写一遍就是重复；
 *   · h2 自带一条顶部渐隐分隔线，紧挨着它的 `---` 是两条线叠在一起，只剩多余的留白。
 * 这些惯例在纯文本里是必要的，在页面上则是噪音 —— 统一在这里判断掉。
 *
 * ⚠️ 调用方只能「跳过渲染」，不能把数组 filter 掉再重排下标：
 * 划线笔记的坐标是按块的序号路径（`0` / `1.2` / `3|0.1`）定位的，
 * 下标一旦移位，用户已有的笔记就会整体画到别的段落上去。
 */

/** 去掉章节序号、空白与标点，只留下用于比对的正文字符 */
function normalizeHeadingText(text: string): string {
  return (
    text
      // 开头的「01 · 」「1. 」「2、」这类章节序号：正文标题里常见，页面标题里通常没有
      .replace(/^\s*\d+\s*[·・.。、:：)）-]\s*/, '')
      // 空白一律去掉：中英文混排时空格位置经常对不齐（"Vite 8" / "Vite8"）
      .replace(/[\s\u3000]+/g, '')
      // 标点一律去掉：全角半角、中英标点混用会让"看起来一样"的两句话不相等
      .replace(/[，,。.、：:；;（）()【】[\]「」『』“”"'’·]/g, '')
      .toLowerCase()
  );
}

/**
 * 判断两段文字是不是在说同一个标题。
 *
 * 除了完全相等，还允许**一方是另一方的前缀**，因为文档里这两种写法很常见：
 *   · 页面标题把正文标题截短了：`阶段 4：Dexie 本地数据层` ← `阶段 4：Dexie 本地数据层（离线优先的地基）`
 *   · 正文标题末尾多一句副标题：`总览：你要做出什么，以及为什么这样做` ← `总览：你要做出什么`
 * 前缀匹配要求重叠部分至少 8 个字符，避免「React」这类短词把无关标题误判成重复。
 */
export function isSameDocTitle(headingText: string, pageTitle: string): boolean {
  const a = normalizeHeadingText(headingText);
  const b = normalizeHeadingText(pageTitle);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 8 && longer.startsWith(shorter);
}

/**
 * 该块是否属于「在网页上重复、应当跳过」。
 *
 * @param blocks    整篇正文的块序列（需要看邻居，所以传整个数组）
 * @param index     当前块下标
 * @param pageTitle 页面头部正在显示的标题；不传则不做标题去重（例如嵌入式预览场景）
 */
export function isRedundantBlock(
  blocks: readonly Block[],
  index: number,
  pageTitle?: string,
): boolean {
  const block = blocks[index];
  if (!block) return false;

  // 1. 正文首个 H1 与页面标题重复。只认 depth === 1：
  //    更深层级的标题是章节名，不可能与文档标题撞车。
  if (index === 0 && pageTitle && block.type === 'heading' && block.depth === 1) {
    return isSameDocTitle(inlineText(block.inline), pageTitle);
  }

  if (block.type === 'divider') {
    // 2. 分隔线后面紧跟 h1/h2：这两个层级自带一条顶部渐隐分隔线，
    //    再叠一条 hr 看不出"两条线"的层次，只白白多出 2.4em 空白。
    //    h3/h4 没有上方分隔线，它们前面的 hr 是唯一的分隔手段 —— 必须保留。
    const next = blocks[index + 1];
    if (next && next.type === 'heading' && next.depth <= 2) return true;

    // 3. 文末孤零零的一条分隔线：后面已经没有内容，它分隔不了任何东西。
    if (index === blocks.length - 1) return true;
  }

  return false;
}

/**
 * 逐块给出「是否跳过」，下标与原数组一一对齐。
 *
 * 返回布尔数组而不是过滤后的新数组，是因为**下标不能变**（见文件头注释）。
 *
 * 这个结果必须被渲染层和锚点层共用同一份：正文渲染跳过哪些块，
 * `collectUnits` 就必须跳过同样的块。两边一旦不一致，
 * 锚点单元列表里就会出现页面上并不存在的"幽灵单元"，
 * 笔记自愈（relocateSegments）可能把某条笔记定位到一个渲染不出来的路径上，
 * 表现为"笔记还在列表里，正文里却找不到标记"。
 */
export function redundantFlags(blocks: readonly Block[], pageTitle?: string): boolean[] {
  return blocks.map((_, index) => isRedundantBlock(blocks, index, pageTitle));
}
