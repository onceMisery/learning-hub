import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

const COLLAPSE_THRESHOLD = 28;

interface CodeBlockProps {
  /** 构建期 Shiki 生成的高亮 HTML（已转义，来源为仓库内受信任内容） */
  html: string;
  /** 原始代码，用于复制 */
  code: string;
  lang: string;
  lines: number;
  caption?: string | null;
}

/**
 * 代码块。
 *
 * 高亮在构建期完成，这里只做展示与交互：
 * 复制、折叠长代码、语言标签。
 */
export function CodeBlock({ html, code, lang, lines, caption }: CodeBlockProps) {
  const collapsible = lines > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!collapsible);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 非安全上下文（http）下剪贴板不可用，退化为选中文本
      setCopied(false);
    }
  }, [code]);

  return (
    <figure className="lh-code" data-collapsed={collapsible && !expanded}>
      <figcaption className="lh-code-bar">
        <span className="font-mono uppercase tracking-wide">{lang || 'text'}</span>
        <span className="flex items-center gap-1">
          {collapsible ? (
            <button
              type="button"
              className="lh-btn"
              style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? '收起' : `展开 ${lines} 行`}
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
            </button>
          ) : null}
          <button
            type="button"
            className="lh-btn"
            style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
            onClick={copy}
            aria-label="复制代码"
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? '已复制' : '复制'}
          </button>
        </span>
      </figcaption>
      {/* Shiki 输出已在构建期完成 HTML 转义，且内容来自本仓库受信任的 Markdown */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {collapsible && !expanded ? <div className="lh-code-fade" /> : null}
      {caption ? (
        <div className="border-t border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--text-3)]">
          {caption}
        </div>
      ) : null}
    </figure>
  );
}
