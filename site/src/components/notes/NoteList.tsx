import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '../Icon';
import { cn, formatDateTime } from '@/lib/format';
import type { NoteColor } from '@/lib/note-anchor';
import type { NoteRecord } from '@/lib/notes';
import { NoteSwatches } from './NoteSwatches';

interface NoteListProps {
  open: boolean;
  notes: NoteRecord[];
  storageError: boolean;
  onClose: () => void;
  /** 跳转到正文里的标记位置 */
  onLocate: (id: string) => void;
  onEdit: (id: string) => void;
  /** 卡片上直接换色：这是最顺手的改色入口，不必打开编辑弹层 */
  onColorChange: (id: string, color: NoteColor) => void;
  onDelete: (id: string) => void;
}

/**
 * 统一的笔记列表：汇总当前文档的全部划线笔记。
 *
 * 做成右侧抽屉而不是独立路由页，是因为笔记天然要"和原文对照"——
 * 跳走到另一个页面会让用户失去阅读上下文（进度也会被打断）。
 */
export function NoteList({
  open,
  notes,
  storageError,
  onClose,
  onLocate,
  onEdit,
  onColorChange,
  onDelete,
}: NoteListProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 每次打开都重置删除确认，避免下次打开就处于"待确认删除"的危险状态
  useEffect(() => {
    if (!open) setConfirmId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div data-note-ui="" className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="本页划线笔记"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
            className="relative flex h-full w-full max-w-[380px] flex-col border-l border-[var(--border)] bg-[var(--bg)]"
          >
            <div className="flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
              <Icon name="list" size={15} className="text-[var(--text-3)]" />
              <span className="text-[13.5px] font-medium text-[var(--text)]">划线笔记</span>
              <span className="lh-chip !h-5 !px-2 !text-[11px]">{notes.length}</span>
              <button
                type="button"
                className="lh-btn ml-auto !h-7 !w-7 !px-0"
                onClick={onClose}
                aria-label="关闭笔记列表"
                title="关闭（Esc）"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {notes.length === 0 ? (
                <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-4 py-10 text-center">
                  <div className="mb-2 flex justify-center text-[var(--text-3)]">
                    <Icon name="highlight" size={20} />
                  </div>
                  <p className="text-[13.5px] font-medium text-[var(--text)]">还没有划线笔记</p>
                  <p className="mt-1 text-[12.5px] leading-[1.7] text-[var(--text-2)]">
                    在正文里拖选文字，或长按选中一段话，就能高亮、加下划线并写下笔记。
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
                    >
                      <div className="mb-2 flex items-center gap-1.5">
                        <span
                          className="lh-chip !h-5 !gap-1 !px-1.5 !text-[11px]"
                          title={note.style === 'highlight' ? '高亮' : '下划线'}
                        >
                          <Icon name={note.style === 'highlight' ? 'highlight' : 'underline'} size={11} />
                          {note.style === 'highlight' ? '高亮' : '下划线'}
                        </span>
                        <NoteSwatches
                          size="sm"
                          value={note.color}
                          onChange={(color) => onColorChange(note.id, color)}
                          groupLabel="改这条笔记的颜色"
                          action="改色"
                        />
                        {note.note.trim() ? (
                          <span className="lh-chip !h-5 !px-1.5 !text-[11px]">有笔记</span>
                        ) : null}
                        {note.orphaned ? (
                          <span
                            className="lh-chip !h-5 !px-1.5 !text-[11px] !text-[var(--warn)]"
                            title="内容更新后无法定位到原文，笔记内容仍已保留"
                          >
                            原文已变更
                          </span>
                        ) : null}
                        <span className="ml-auto text-[11px] text-[var(--text-3)]">
                          {formatDateTime(note.createdAt)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onLocate(note.id)}
                        disabled={note.orphaned}
                        title={note.orphaned ? '原文位置已失效' : '在正文中定位'}
                        className={cn(
                          'lh-note-quote block w-full px-2.5 py-1.5 text-left',
                          note.orphaned
                            ? 'cursor-default opacity-70'
                            : 'transition-colors hover:bg-[var(--surface-2)]',
                        )}
                      >
                        <span className="line-clamp-3">{note.text || '（无原文片段）'}</span>
                      </button>

                      {note.note.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-[var(--text)]">
                          {note.note}
                        </p>
                      ) : null}

                      <div className="mt-2 flex items-center gap-1">
                        <span className="text-[11px] text-[var(--text-3)]">
                          更新 {formatDateTime(note.updatedAt)}
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            className="lh-btn !h-7 !px-2 !text-[12px]"
                            onClick={() => onLocate(note.id)}
                            disabled={note.orphaned}
                            title={note.orphaned ? '原文位置已失效' : '在正文中定位'}
                          >
                            <Icon name="target" size={12} />
                            定位
                          </button>
                          <button
                            type="button"
                            className="lh-btn !h-7 !px-2 !text-[12px]"
                            onClick={() => onEdit(note.id)}
                          >
                            <Icon name="note" size={12} />
                            编辑
                          </button>
                          {confirmId === note.id ? (
                            <>
                              <button
                                type="button"
                                className="lh-btn !h-7 !px-2 !text-[12px] !text-[var(--danger)]"
                                onClick={() => {
                                  setConfirmId(null);
                                  onDelete(note.id);
                                }}
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                className="lh-btn !h-7 !px-2 !text-[12px]"
                                onClick={() => setConfirmId(null)}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="lh-btn !h-7 !w-7 !px-0"
                              onClick={() => setConfirmId(note.id)}
                              aria-label="删除这条笔记"
                              title="删除"
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--border)] px-4 py-2.5">
              {storageError ? (
                <p className="text-[11.5px] leading-[1.6] text-[var(--warn)]">
                  浏览器本地存储不可用或已写满，新笔记只保存在当前页面，刷新后会丢失。
                </p>
              ) : (
                <p className="text-[11.5px] leading-[1.6] text-[var(--text-3)]">
                  笔记只保存在这台设备的浏览器里，不会上传到任何服务器。
                </p>
              )}
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
