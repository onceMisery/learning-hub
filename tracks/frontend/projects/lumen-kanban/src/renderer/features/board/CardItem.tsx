import { motion } from 'motion/react';
import type { DragEvent } from 'react';
import type { Card } from '@shared/types';
import { cn } from '@/lib/cn';

const priorityMeta: Record<Card['priority'], { label: string; className: string }> = {
  0: { label: '低', className: 'bg-surface-sunken text-fg-muted' },
  1: { label: '中', className: 'bg-brand-soft text-fg' },
  2: { label: '高', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

interface CardItemProps {
  card: Card;
  onOpen: () => void;
  /** 有卡片拖到自己上方时触发，交出原始事件以便读取 dataTransfer */
  onDropBefore: (event: DragEvent<HTMLDivElement>) => void;
}

/**
 * 结构说明：
 * motion.li 只负责进出场与布局动画，原生拖放事件挂在内层 div 上。
 * 为什么不直接把 onDrop 写在 motion.li 上？
 * 因为 Motion 组件自带 onDragStart/onDragOver/onDrop（它自己手势系统的回调），
 * 与 React 原生拖放事件签名冲突，会报类型不兼容。
 */
/**
 * 不依赖组件作用域，提到模块级：避免每次渲染都重建函数。
 * 必须 preventDefault，否则浏览器不允许 drop；
 * stopPropagation 阻止冒泡，否则会同时触发列的"追加到末尾"。
 */
const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
  event.preventDefault();
  event.stopPropagation();
};

export function CardItem({ card, onOpen, onDropBefore }: CardItemProps) {
  const meta = priorityMeta[card.priority];

  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData('text/plain', card.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    onDropBefore(event);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="list-none"
    >
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="rounded-card border border-line bg-surface-raised p-2.5 shadow-sm"
      >
        <button
          type="button"
          onClick={onOpen}
          className="w-full cursor-pointer text-left text-sm text-fg"
        >
          {card.title}
        </button>

        <div className="mt-2 flex items-center gap-1.5">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px]', meta.className)}>
            {meta.label}
          </span>
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-fg-muted"
            >
              #{tag}
            </span>
          ))}
          {card.done === 1 ? (
            <span className="ml-auto text-[11px] text-green-600 dark:text-green-400">已完成</span>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}
