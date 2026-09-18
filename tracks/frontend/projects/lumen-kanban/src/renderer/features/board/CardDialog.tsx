import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Card, Priority } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { db } from '@/db/db';
import { useHistoryStore } from '@/history/store';

const parseTags = (raw: string): string[] =>
  raw
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

interface CardDialogProps {
  cardId: string;
  onClose: () => void;
}

export function CardDialog({ cardId, onClose }: CardDialogProps) {
  const card = useLiveQuery(() => db.cards.get(cardId), [cardId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!card) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="编辑卡片"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-card border border-line bg-surface-raised p-4 shadow-xl"
      >
        {/* key=card.id：切换到另一张卡时让表单重新挂载，
            用"重置组件"代替"用 effect 同步 state"，少一次渲染且不会状态残留 */}
        <CardForm key={card.id} card={card} onClose={onClose} />
      </motion.div>
    </motion.div>
  );
}

function CardForm({ card, onClose }: { card: Card; onClose: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [tags, setTags] = useState(card.tags.join(', '));
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [done, setDone] = useState<0 | 1>(card.done);
  const execute = useHistoryStore((state) => state.execute);

  const handleSave = async (): Promise<void> => {
    const value = title.trim();
    if (!value) return;

    const next = {
      title: value,
      notes,
      tags: parseTags(tags),
      priority,
      done,
    };

    // 把"改动前的值"一并记进命令，撤销时才有依据（而不是猜）
    const prev = {
      title: card.title,
      notes: card.notes,
      tags: card.tags,
      priority: card.priority,
      done: card.done,
    };

    const changed = (Object.keys(next) as Array<keyof typeof next>).some(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(prev[key]),
    );
    if (!changed) {
      onClose();
      return;
    }

    await execute({ kind: 'updateCard', label: `修改「${card.title}」`, id: card.id, next, prev });
    onClose();
  };

  const handleDelete = async (): Promise<void> => {
    // 整张卡片存进命令：撤销时才能原样加回来
    await execute({ kind: 'removeCard', label: `删除「${card.title}」`, card });
    onClose();
  };

  return (
    <>
      <h2 className="mb-3 text-sm font-medium text-fg">编辑卡片</h2>

      <label className="mb-1 block text-xs text-fg-muted" htmlFor="card-title">
        标题
      </label>
      <input
        id="card-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mb-3 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-fg"
      />

      <label className="mb-1 block text-xs text-fg-muted" htmlFor="card-notes">
        备注
      </label>
      <textarea
        id="card-notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={3}
        className="mb-3 w-full rounded-md border border-line bg-surface p-2 text-sm text-fg"
      />

      <div className="mb-3 flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-fg-muted" htmlFor="card-tags">
            标签（逗号分隔）
          </label>
          <input
            id="card-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-fg"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted" htmlFor="card-priority">
            优先级
          </label>
          <select
            id="card-priority"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value) as Priority)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
          >
            <option value={0}>低</option>
            <option value={1}>中</option>
            <option value={2}>高</option>
          </select>
        </div>
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={done === 1} onChange={() => setDone(done === 1 ? 0 : 1)} />
        标记为已完成
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
          删除
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button size="sm" onClick={() => void handleSave()}>
          保存
        </Button>
      </div>
    </>
  );
}
