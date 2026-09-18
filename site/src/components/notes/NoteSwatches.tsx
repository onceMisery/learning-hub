import { NOTE_COLORS, type NoteColor } from '@/lib/note-anchor';
import { cn } from '@/lib/format';

/** 色名只用于无障碍标签与悬浮提示：颜色本身不预设语义，分类交给用户 */
const COLOR_LABEL: Record<NoteColor, string> = {
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  pink: '粉色',
  purple: '紫色',
};

interface NoteSwatchesProps {
  /**
   * 当前颜色。传 null 表示"这里没有选中态"——
   * 选区浮层里的色点是动作（点哪个色就落地哪条），不是单选框，
   * 给它画一个选中环会误导用户以为蓝色是"已生效"的。
   */
  value: NoteColor | null;
  onChange: (color: NoteColor) => void;
  /** sm 用于笔记列表的卡片里，md 用于浮层与编辑弹层 */
  size?: 'sm' | 'md';
  /** 接在"以X色"后面的动作词：浮层里是"高亮"/"加下划线"，编辑弹层里不传 */
  action?: string;
  groupLabel?: string;
  className?: string;
}

/**
 * 五色色板。三个入口（选区浮层 / 编辑弹层 / 笔记列表）共用同一份实现，
 * 保证"在哪儿看到的色板顺序都一样"。
 *
 * 每个色点都必须阻止 mousedown 的默认行为：否则按下的瞬间浏览器会清空选区，
 * 浮层随后就再也拿不到用户想划的那段文字了。
 */
export function NoteSwatches({
  value,
  onChange,
  size = 'md',
  action = '',
  groupLabel = '划线颜色',
  className,
}: NoteSwatchesProps) {
  return (
    <div role="group" aria-label={groupLabel} className={cn('flex items-center gap-1.5', className)}>
      {NOTE_COLORS.map((color) => {
        const label = action ? `以${COLOR_LABEL[color]}${action}` : COLOR_LABEL[color];
        return (
          <button
            key={color}
            type="button"
            data-color={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(color)}
            aria-pressed={value === null ? undefined : value === color}
            aria-label={label}
            title={label}
            className={cn('lh-note-swatch', size === 'sm' && 'h-3.5 w-3.5')}
          />
        );
      })}
    </div>
  );
}
