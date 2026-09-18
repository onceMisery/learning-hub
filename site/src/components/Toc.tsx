import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';
import type { Heading } from '@/types/content';

interface TocProps {
  headings: Heading[];
}

/**
 * 右侧目录。
 *
 * 用 IntersectionObserver 跟踪当前可视标题。
 * 观察窗口被压缩到视口上方一小段，这样滚动时高亮切换更贴合直觉。
 */
export function Toc({ headings }: TocProps) {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId(null);
      return;
    }
    const nodes = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((node): node is HTMLElement => node !== null);

    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -70% 0px', threshold: [0, 1] },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="本页目录" className="text-[12.5px]">
      <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">本页目录</p>
      <ul className="space-y-[3px] border-l border-[var(--border)]">
        {headings.map((heading) => {
          const active = heading.id === activeId;
          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                aria-current={active ? 'location' : undefined}
                className={cn(
                  '-ml-px block border-l py-[3px] pr-2 text-[var(--text-3)] transition-colors duration-150',
                  heading.depth === 2 ? 'pl-3' : 'pl-6',
                  active
                    ? 'border-[var(--brand)] font-medium text-[var(--brand)]'
                    : 'border-transparent hover:border-[var(--border-strong)] hover:text-[var(--text-2)]',
                )}
              >
                <span className="line-clamp-2">{heading.text}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
