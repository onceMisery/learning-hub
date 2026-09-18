import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Icon } from '../Icon';
import { cn } from '@/lib/format';
import type { AnchorRect, NoteColor, NoteStyle } from '@/lib/note-anchor';
import { NoteSwatches } from './NoteSwatches';

interface NoteToolbarProps {
  /** 选区在视口中的位置，用于把浮层贴在选区上方 */
  anchor: AnchorRect;
  /** 当前待应用的样式：点色点时用它在"高亮 / 下划线"之间取值 */
  style: NoteStyle;
  onStyleChange: (style: NoteStyle) => void;
  /** 点色点 = 直接用「当前样式 + 该色」落地，一步到位 */
  onPick: (color: NoteColor) => void;
  onNote: () => void;
  onDismiss: () => void;
}

const GAP = 8;
const EDGE = 8;

/**
 * 选区操作浮层：拖选 / 长按选中文字后贴在选区上方弹出。
 *
 * 定位用 position: fixed 并对视口夹紧。浮层挂在 portal 下（见 NoteLayer），
 * 不挂在正文里，因此既不会被正文祖先的 transform 影响定位，
 * 也不会被 overflow 容器裁掉。
 *
 * 交互分工（避免"点一下到底会发生什么"含糊）：
 *   · 样式按钮是**分段开关**，只切换"接下来用哪种样式"，自己不落地；
 *   · 色点是**动作**，点哪个色就用「当前样式 + 该色」立即落地。
 * 于是"一步高亮"仍然是点一下（默认样式就是高亮），而"紫色下划线"也只要两步。
 *
 * 按钮上阻止 mousedown 默认行为：否则按下按钮的瞬间浏览器会清空选区，
 * 我们随后就再也拿不到用户想划的那段文字了。
 */
export function NoteToolbar({ anchor, style, onStyleChange, onPick, onNote, onDismiss }: NoteToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 尺寸要等测量后才知道；先隐藏，避免首帧以错误宽度贴边溢出
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
  }, [anchor.top, anchor.left, anchor.width, style]);

  const centered = anchor.left + anchor.width / 2;
  const half = size.width / 2;
  const left = Math.min(Math.max(centered, EDGE + half), window.innerWidth - EDGE - half);
  // 选区上方放不下就翻到下方
  const above = anchor.top - GAP - size.height >= EDGE;
  const top = above ? anchor.top - GAP - size.height : anchor.bottom + GAP;

  return (
    <motion.div
      ref={ref}
      data-note-ui=""
      role="toolbar"
      aria-label="划线笔记操作"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.14, ease: [0.215, 0.61, 0.355, 1] }}
      className="fixed z-50 flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow)]"
      style={{
        left,
        top,
        transformOrigin: above ? 'bottom center' : 'top center',
        translateX: '-50%',
        visibility: size.width === 0 ? 'hidden' : 'visible',
      }}
    >
      <StyleButton
        icon="highlight"
        label="高亮"
        active={style === 'highlight'}
        onClick={() => onStyleChange('highlight')}
      />
      <StyleButton
        icon="underline"
        label="下划线"
        active={style === 'underline'}
        onClick={() => onStyleChange('underline')}
      />
      <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
      <NoteSwatches
        value={null}
        onChange={onPick}
        groupLabel="选择颜色并应用"
        action={style === 'highlight' ? '高亮' : '加下划线'}
        className="mx-0.5"
      />
      <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
      <ToolbarButton icon="note" label="笔记" onClick={onNote} />
      <button
        type="button"
        className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDismiss}
        aria-label="取消"
        title="取消"
      >
        <Icon name="close" size={13} />
      </button>
    </motion.div>
  );
}

/**
 * 样式开关：选中态靠底色表达，靠图标本身也能认出来
 * （窄屏隐去文字后仍然可辨，无障碍名用 aria-label 兜住）。
 */
function StyleButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: 'highlight' | 'underline';
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      // aria-label 保持稳定：选中与否由 aria-pressed 表达，
      // 把状态写进名字会让"按无障碍名找按钮"的脚本与读屏体验都随状态漂移
      aria-label={label}
      title={active ? `${label}（当前样式）——选好颜色后应用` : `${label}——选好颜色后应用`}
      className={cn(
        'flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] transition-colors',
        active
          ? 'bg-[var(--surface-3)] text-[var(--text)]'
          : 'text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text-2)]',
      )}
    >
      <Icon name={icon} size={13} />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: 'note'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <Icon name={icon} size={13} />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}
