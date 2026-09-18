import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/ui/States';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-[var(--content-max)] py-10">
      <EmptyState
        icon="search"
        title="404 · 没有这个页面"
        description="链接可能已经失效。试试从首页或搜索重新进入。"
        action={
          <div className="flex gap-2">
            <Link to="/" className="lh-btn">
              <Icon name="arrow-left" size={13} />
              返回首页
            </Link>
          </div>
        }
      />
    </div>
  );
}
