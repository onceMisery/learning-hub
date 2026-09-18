import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Icon } from '../Icon';
import { cn, formatDateTime } from '@/lib/format';
import type { NoteColor, NoteStyle } from '@/lib/note-anchor';
import { NoteSwatches } from './NoteSwatches';

interface NoteEditorProps {
  mode: 'create' | 'edit';
  /** 被划线的原文，作为笔记的上下文 */
  quote: string;
  style: NoteStyle;
  color: NoteColor;
  note: string;
  /** 编辑已有笔记时展示更新时间 */
  updatedAt?: number;
  /** 内容变更后已无法定位到原文 */
  orphaned?: boolean;
  onStyleChange: (style: NoteStyle) => void;
  onColorChange: (color: NoteColor) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

const STYLE_OPTIONS: { value: NoteStyle; label: string; icon: 'highlight' | 'underline' }[] = [
  { value: 'highlight', label: '高亮', icon: 'highlight' },
  { value: 'underline', label: '下划线', icon: 'underline' },
];

/**
 * 笔记编辑弹层。
 *
 * 刻意做成**居中弹层**而不是在选区旁边弹小卡片：
 * 选区旁的浮层一旦用户滚动就会飘走，而写笔记是需要停留一段时间的行为。
 * 居中弹层不随滚动漂移，移动端也不会被软键盘顶出可视区。
 */
export function NoteEditor({
  mode,
  quote,
  style,
  color,
  note,
  updatedAt,
  orphaned = false,
  onStyleChange,
  onColorChange,
  onNoteChange,
  onSave,
  onDelete,
  onClose,
}: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // ⌘/Ctrl + Enter 保存：长笔记时手不必离开键盘
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onSave]);

  const title = mode === 'create' ? '添加笔记' : '编辑笔记';

  return (
    <div data-note-ui="" className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.215, 0.61, 0.355, 1] }}
        className="relative m-0 w-full max-w-[480px] overflow-hidden rounded-t-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow)] sm:rounded-[var(--radius-xl)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <span className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--text)]">
            <Icon name="note" size={14} />
            {title}
          </span>
          <button
            type="button"
            className="lh-btn !h-7 !w-7 !px-0"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="max-h-[min(62vh,520px)] overflow-y-auto px-4 py-3.5">
          {orphaned ? (
            <p className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-[12.5px] text-[var(--text-2)]">
              这段原文在最新内容里已经找不到了，位置标记已失效，但笔记内容仍然保留。
            </p>
          ) : null}

          <p className="lh-note-quote mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap px-3 py-2">
            {quote || '（原文片段为空）'}
          </p>

          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-3)]">划线样式</span>
            <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] p-0.5">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onStyleChange(option.value)}
                  aria-pressed={style === option.value}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-colors',
                    style === option.value
                      ? 'bg-[var(--surface-3)] text-[var(--text)]'
                      : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
                  )}
                >
                  <Icon name={option.icon} size={12} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-3)]">划线颜色</span>
            <NoteSwatches value={color} onChange={onColorChange} />
          </div>

          <textarea
            ref={textareaRef}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            rows={5}
            placeholder="写下你的理解、疑问或待办…（可留空，只保留划线）"
            aria-label="笔记内容"
            className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[13.5px] leading-[1.7] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--brand)]"
          />

          {updatedAt ? (
            <p className="mt-2 text-[11.5px] text-[var(--text-3)]">最后更新 {formatDateTime(updatedAt)}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5">
          {onDelete ? (
            confirmDelete ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[12px] text-[var(--text-2)]">确定删除？</span>
                <button
                  type="button"
                  className="lh-btn !h-7 !px-2 !text-[12px] !text-[var(--danger)]"
                  onClick={onDelete}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="lh-btn !h-7 !px-2 !text-[12px]"
                  onClick={() => setConfirmDelete(false)}
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="lh-btn !h-7 !px-2 !text-[12px]"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={12} />
                删除
              </button>
            )
          ) : (
            <span />
          )}

          <span className="flex items-center gap-2">
            <span className="hidden text-[11.5px] text-[var(--text-3)] sm:block">⌘/Ctrl + Enter 保存</span>
            <button type="button" className="lh-btn !h-8" onClick={onSave}>
              <Icon name="check" size={13} />
              保存
            </button>
          </span>
        </div>
      </motion.div>
    </div>
  );
}
