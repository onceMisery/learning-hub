import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90',
  secondary: 'bg-surface-raised text-fg border border-line hover:border-line-strong',
  ghost: 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...rest} />;
}
