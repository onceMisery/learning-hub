import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

const PRESET: Record<string, { icon: IconName; label: string; color: string }> = {
  info: { icon: 'sparkles', label: '说明', color: 'var(--brand)' },
  warn: { icon: 'alert', label: '注意', color: 'var(--warn)' },
  success: { icon: 'check', label: '建议', color: 'var(--success)' },
  danger: { icon: 'alert', label: '警告', color: 'var(--danger)' },
};

interface CalloutProps {
  kind: 'info' | 'warn' | 'success' | 'danger';
  title: string;
  children: ReactNode;
}

/** 提示块：用于「坑」「注意」「验收点」等需要打断阅读节奏的内容 */
export function Callout({ kind, title, children }: CalloutProps) {
  const preset = PRESET[kind] ?? PRESET.info!;
  return (
    <aside
      className="my-6 flex gap-3 rounded-[var(--radius-md)] border px-4 py-3.5"
      style={{
        borderColor: `color-mix(in srgb, ${preset.color} 32%, transparent)`,
        // 左侧实色条：整页提示块形成一条可扫读的"警示轨"
        borderLeft: `3px solid ${preset.color}`,
        background: `color-mix(in srgb, ${preset.color} 8%, transparent)`,
      }}
    >
      <span
        className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full"
        style={{
          color: preset.color,
          background: `color-mix(in srgb, ${preset.color} 16%, transparent)`,
        }}
      >
        <Icon name={preset.icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium" style={{ color: preset.color }}>
          {title || preset.label}
        </p>
        <div className="mt-1 text-[15px] leading-[1.78] text-[var(--text)] [&>*+*]:mt-2 [&_p]:m-0">
          {children}
        </div>
      </div>
    </aside>
  );
}
