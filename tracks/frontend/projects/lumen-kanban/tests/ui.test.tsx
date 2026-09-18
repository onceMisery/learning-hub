import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

describe('cn()', () => {
  it('合并类名并让后者覆盖冲突项', () => {
    expect(cn('px-3 py-2', 'px-8')).toBe('py-2 px-8');
    expect(cn('text-sm', false && 'hidden', 'font-medium')).toBe('text-sm font-medium');
  });
});

describe('Button', () => {
  it('渲染子节点，且外部 className 能覆盖默认尺寸', () => {
    render(<Button className="px-8">保存</Button>);

    const button = screen.getByRole('button', { name: '保存' });
    expect(button.className).toContain('px-8');
    // tailwind-merge 应移除与 px-8 冲突的默认 px-3
    expect(button.className).not.toContain('px-3');
  });

  it('disabled 时不可点击', () => {
    render(
      <Button disabled onClick={() => undefined}>
        导出
      </Button>,
    );

    expect(screen.getByRole('button', { name: '导出' }).hasAttribute('disabled')).toBe(true);
  });
});
