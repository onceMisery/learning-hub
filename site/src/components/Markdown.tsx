import { Fragment, type ReactNode } from 'react';
import type { Block, Inline, ListItem as ListItemData } from '@/types/content';
import { assetUrl } from '@/lib/content';
import { cn } from '@/lib/format';
import {
  childPath,
  tableHeaderPath,
  tableRowPath,
  type InlineMark,
} from '@/lib/note-anchor';
import { Icon } from './Icon';
import { CodeBlock } from './blocks/CodeBlock';
import { Callout } from './blocks/Callout';
import { SourceRef } from './blocks/SourceRef';
import { LangTabs } from './blocks/LangTabs';

/**
 * 行内节点渲染，并在渲染的同时把「划线笔记」的标记切进文本流。
 *
 * 为什么不直接改 DOM（把 Range 包成 <mark>）：
 * 正文是 React 渲染的，外部再动手改 DOM，下一次 re-render 就会把改动抹掉或错位。
 * 所以标记在**行内节点树**上完成：把叶子文本按标记边界切成若干片，
 * 命中标记的片包一层 <mark>。这样：
 *   · 完全在 React 的掌控内，主题切换、翻页、重新渲染都不会丢；
 *   · strong / em / link 内部的文字照样能划（递归时游标连续）；
 *   · 切分不改变文本长度，因此偏移量不会因渲染而漂移。
 */

/** 共享的空数组：避免每次渲染都产生新引用，把纯展示的段落也拖进 re-render */
const NO_MARKS: InlineMark[] = [];
const noMarks = (): InlineMark[] => NO_MARKS;

function markClass(mark: InlineMark): string {
  return cn(
    'lh-hl',
    `lh-hl--c-${mark.color}`,
    mark.style === 'underline' && 'lh-hl--underline',
    mark.hasNote && 'lh-hl--noted',
  );
}

/** 取走一段文本的长度并推进游标，返回该段在单元内的起始偏移 */
function take(cursor: { v: number }, length: number): number {
  const at = cursor.v;
  cursor.v += length;
  return at;
}

/**
 * 把一段叶子文本按标记边界切片，命中的片包 <mark>。
 *
 * 因为同一篇文档内笔记区间互不相交（见 note-anchor.subtractSegments），
 * 每个切片最多只属于一条笔记，不需要处理"多层嵌套标记"。
 */
function leafPieces(
  value: string,
  start: number,
  marks: readonly InlineMark[],
  key: string,
  render: (text: string) => ReactNode,
): ReactNode[] {
  const end = start + value.length;
  const active = marks.filter((mark) => mark.end > start && mark.start < end);
  if (active.length === 0) return [<Fragment key={key}>{render(value)}</Fragment>];

  const cuts = new Set<number>([start, end]);
  for (const mark of active) {
    cuts.add(Math.max(mark.start, start));
    cuts.add(Math.min(mark.end, end));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const pieces: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const text = value.slice(from - start, to - start);
    const owner = active.find((mark) => mark.start <= from && mark.end >= to);
    if (!owner) {
      pieces.push(<Fragment key={`${key}#${i}`}>{render(text)}</Fragment>);
      continue;
    }
    pieces.push(
      <mark
        key={`${key}#${i}`}
        data-note-id={owner.id}
        className={markClass(owner)}
        title={owner.hasNote ? '点击查看或编辑笔记' : '点击为这段文字添加笔记'}
      >
        {render(text)}
      </mark>,
    );
  }
  return pieces;
}

/** 递归渲染行内节点，游标随渲染推进，保证偏移与 inlineText() 口径一致 */
function renderNodes(nodes: readonly Inline[], cursor: { v: number }, marks: readonly InlineMark[]): ReactNode[] {
  const out: ReactNode[] = [];

  nodes.forEach((node, index) => {
    const key = `i-${index}`;
    switch (node.type) {
      case 'text':
      case 'raw':
        // 原始 HTML 一律转义展示，杜绝注入
        out.push(...leafPieces(node.value, take(cursor, node.value.length), marks, key, (text) => text));
        break;
      case 'code':
        out.push(
          ...leafPieces(node.value, take(cursor, node.value.length), marks, key, (text) => (
            <code className="lh-inline-code">{text}</code>
          )),
        );
        break;
      case 'strong':
        out.push(<strong key={key}>{renderNodes(node.children, cursor, marks)}</strong>);
        break;
      case 'em':
        out.push(<em key={key}>{renderNodes(node.children, cursor, marks)}</em>);
        break;
      case 'del':
        out.push(<del key={key}>{renderNodes(node.children, cursor, marks)}</del>);
        break;
      case 'link':
        out.push(
          node.external ? (
            <a key={key} href={node.href} target="_blank" rel="noreferrer">
              {renderNodes(node.children, cursor, marks)}
              <Icon name="external" size={11} className="ml-0.5 inline align-[-1px] opacity-60" />
            </a>
          ) : (
            <a key={key} href={node.href}>
              {renderNodes(node.children, cursor, marks)}
            </a>
          ),
        );
        break;
      case 'image':
        // 图片不产生文本，占位为 0 —— 与 inlineText() 一致
        out.push(
          // eslint-disable-next-line jsx-a11y/alt-text -- alt 由 Markdown 提供
          <img key={key} src={assetUrl(node.src)} alt={node.alt} loading="lazy" />,
        );
        break;
      case 'break':
        out.push(<br key={key} />);
        break;
      default:
        break;
    }
  });

  return out;
}

/** 行内节点渲染入口 */
export function InlineNodes({ nodes, marks = NO_MARKS }: { nodes: Inline[]; marks?: readonly InlineMark[] }): ReactNode {
  return <>{renderNodes(nodes, { v: 0 }, marks)}</>;
}

interface MarkdownProps {
  blocks: Block[];
  repoUrl?: string;
  trackDir?: string;
  /**
   * 嵌套在提示块等容器内部时置 true。
   * 外层正文会在相邻块之间画段落分割线，盒中盒再画线会变脏，故用修饰类关掉。
   */
  nested?: boolean;
  /**
   * 该层块列表在整篇文档中的路径前缀（顶层为空串）。
   * 划线笔记的坐标依赖它保持全局唯一，嵌套的 Markdown 必须把自己那一段前缀传进来。
   */
  pathPrefix?: string;
  /** 取某个锚点单元上的划线标记；不传表示这篇正文不可划线 */
  segmentsOf?: (path: string) => readonly InlineMark[];
  /**
   * 逐块标记「是否跳过渲染」，下标需与 blocks 一一对齐。
   *
   * 由调用方算好传进来（见 lib/doc-structure.ts 的 redundantFlags），而不是这里自己判断 ——
   * 因为**锚点层必须复用同一份标记**：正文跳过的块，collectUnits 也得跳过，
   * 否则锚点单元里会多出页面上不存在的项，笔记自愈就会定位到渲染不出来的位置。
   * 同一份数据喂给两边，是这条约束唯一可靠的执行方式。
   */
  skipBlocks?: readonly boolean[];
}

export function Markdown({
  blocks,
  repoUrl,
  trackDir,
  nested = false,
  pathPrefix = '',
  segmentsOf = noMarks,
  skipBlocks,
}: MarkdownProps) {
  return (
    <div className={nested ? 'lh-prose lh-prose--nested' : 'lh-prose'}>
      {blocks.map((block, index) =>
        // 与页头重复的标题、与标题装饰重复的分隔线在这里丢掉。
        // 只返回 null、不做 filter —— 下标必须与数据源保持一致，
        // 否则 childPath 生成的锚点路径会整体移位，已有划线笔记将画到别的段落上。
        skipBlocks?.[index] ? null : (
          <BlockView
            key={`b-${index}`}
            block={block}
            path={childPath(pathPrefix, index)}
            repoUrl={repoUrl}
            trackDir={trackDir}
            segmentsOf={segmentsOf}
          />
        ),
      )}
    </div>
  );
}

interface BlockViewProps {
  block: Block;
  /** 本块在文档中的路径 */
  path: string;
  repoUrl?: string;
  trackDir?: string;
  segmentsOf: (path: string) => readonly InlineMark[];
}

function BlockView({ block, path, repoUrl, trackDir, segmentsOf }: BlockViewProps): ReactNode {
  switch (block.type) {
    case 'heading': {
      // 文档标题由页面头部承担（正文开头重复的那个已在 Markdown 里被跳过），
      // 所以这里把 depth 1 与 2 合流到 h2：在文档层级里两者都是"章节"，
      // 给它们两套视觉规格只会让读者以为漏了一层。depth 1 走到这里属于兜底。
      const Tag = (block.depth === 1 ? 'h2' : block.depth === 2 ? 'h2' : block.depth === 3 ? 'h3' : 'h4') as
        | 'h2'
        | 'h3'
        | 'h4';
      return (
        <Tag id={block.id} className="group" data-block-path={path}>
          <InlineNodes nodes={block.inline} marks={segmentsOf(path)} />
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p data-block-path={path}>
          <InlineNodes nodes={block.inline} marks={segmentsOf(path)} />
        </p>
      );

    case 'code':
      return <CodeBlock html={block.html} code={block.code} lang={block.lang} lines={block.lines} />;

    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <ListItem
              key={index}
              item={item}
              path={childPath(path, index)}
              repoUrl={repoUrl}
              trackDir={trackDir}
              segmentsOf={segmentsOf}
            />
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <ListItem
              key={index}
              item={item}
              path={childPath(path, index)}
              repoUrl={repoUrl}
              trackDir={trackDir}
              segmentsOf={segmentsOf}
            />
          ))}
        </ul>
      );

    case 'table':
      return (
        <div className="lh-table-wrap">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} style={{ textAlign: alignOf(block.align[index]) }} data-block-path={tableHeaderPath(path, index)}>
                    <InlineNodes nodes={cell} marks={segmentsOf(tableHeaderPath(path, index))} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{ textAlign: alignOf(block.align[cellIndex]) }}
                      data-block-path={tableRowPath(path, rowIndex, cellIndex)}
                    >
                      <InlineNodes nodes={cell} marks={segmentsOf(tableRowPath(path, rowIndex, cellIndex))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'quote':
      return (
        <blockquote>
          {block.blocks.map((child, index) => (
            <BlockView
              key={index}
              block={child}
              path={childPath(path, index)}
              repoUrl={repoUrl}
              trackDir={trackDir}
              segmentsOf={segmentsOf}
            />
          ))}
        </blockquote>
      );

    case 'divider':
      return <hr />;

    case 'image':
      return (
        <figure className="my-6">
          <img src={assetUrl(block.src)} alt={block.alt} loading="lazy" />
          {block.alt ? (
            <figcaption className="mt-2 text-center text-[12.5px] text-[var(--text-3)]">{block.alt}</figcaption>
          ) : null}
        </figure>
      );

    case 'sourceRef':
      return (
        <SourceRef
          repo={block.repo}
          file={block.file}
          lines={block.lines}
          symbol={block.symbol}
          caption={block.caption}
          code={block.code}
          html={block.html}
          lang={block.lang}
          error={block.error}
          repoUrl={repoUrl}
          trackDir={trackDir}
        />
      );

    case 'callout':
      // 提示块内部另起一个 Markdown；把当前路径作为前缀传下去，
      // 保证盒内的段落也拥有全局唯一的坐标，而不是从 0 重新开始。
      return (
        <Callout kind={block.kind} title={block.title}>
          <Markdown
            blocks={block.blocks}
            repoUrl={repoUrl}
            trackDir={trackDir}
            pathPrefix={path}
            segmentsOf={segmentsOf}
            nested
          />
        </Callout>
      );

    case 'langTabs':
      return <LangTabs title={block.title} items={block.items} />;

    default:
      return null;
  }
}

/**
 * 列表项。
 *
 * 行内文本单独包一层带 data-block-path 的 span —— 它必须与嵌套列表**平级**，
 * 否则外层单元会把嵌套列表的文字也算进自己的偏移量里，坐标立刻错位。
 */
function ListItem({
  item,
  path,
  repoUrl,
  trackDir,
  segmentsOf,
}: {
  item: ListItemData;
  path: string;
  repoUrl?: string;
  trackDir?: string;
  segmentsOf: (path: string) => readonly InlineMark[];
}): ReactNode {
  return (
    <li className={item.checked === null ? undefined : 'lh-task'}>
      {item.checked === null ? null : (
        <span className="lh-task-box" data-checked={item.checked} aria-hidden="true">
          {item.checked ? <Icon name="check" size={10} /> : null}
        </span>
      )}
      <span>
        <span data-block-path={path}>
          <InlineNodes nodes={item.children} marks={segmentsOf(path)} />
        </span>
        {item.nested ? (
          <NestedBlocks blocks={item.nested} pathPrefix={path} repoUrl={repoUrl} trackDir={trackDir} segmentsOf={segmentsOf} />
        ) : null}
      </span>
    </li>
  );
}

function NestedBlocks({
  blocks,
  pathPrefix,
  repoUrl,
  trackDir,
  segmentsOf,
}: {
  blocks: Block[];
  pathPrefix: string;
  repoUrl?: string;
  trackDir?: string;
  segmentsOf: (path: string) => readonly InlineMark[];
}): ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          path={childPath(pathPrefix, index)}
          repoUrl={repoUrl}
          trackDir={trackDir}
          segmentsOf={segmentsOf}
        />
      ))}
    </>
  );
}

function alignOf(value: string | null | undefined): 'left' | 'center' | 'right' | undefined {
  if (value === 'center' || value === 'right') return value;
  return undefined;
}
