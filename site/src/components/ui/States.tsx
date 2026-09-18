import { Component, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

/** 加载态：骨架屏比转圈更少打断阅读节奏 */
export function DocSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="正在加载内容">
      <div className="h-8 w-2/3 rounded-[var(--radius-md)] bg-[var(--surface-2)]" />
      <div className="mt-6 space-y-3">
        {[92, 100, 78, 96, 64].map((width, index) => (
          <div
            key={index}
            className="h-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)]"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      <div className="mt-8 h-40 rounded-[var(--radius-md)] bg-[var(--surface-2)]" />
    </div>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--brand)] align-middle"
      role="status"
      aria-label={label}
    />
  );
}

interface StateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = 'book', title, description, action }: StateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-3)]">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-[15px] font-medium text-[var(--text)]">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-[var(--text-2)]">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, description, action }: Omit<StateProps, 'icon'>) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-6 py-10 text-center"
    >
      <div className="mb-3 flex justify-center text-[var(--danger)]">
        <Icon name="alert" size={22} />
      </div>
      <p className="text-[15px] font-medium text-[var(--text)]">{title}</p>
      {description ? <p className="mt-1.5 max-w-md text-sm text-[var(--text-2)]">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 兜底边界：任何未捕获渲染错误都收敛为一块可操作的提示，而不是白屏 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[learning-hub] 渲染错误：', error);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto max-w-[var(--content-max)] px-5 py-16">
        <ErrorState
          title="页面渲染出错了"
          description={error.message || '发生了未知错误，可以重试或返回首页。'}
          action={
            <div className="flex gap-2">
              <button type="button" className="lh-btn" onClick={this.handleReset}>
                重试
              </button>
              <a className="lh-btn" href="/">
                返回首页
              </a>
            </div>
          }
        />
      </div>
    );
  }
}
