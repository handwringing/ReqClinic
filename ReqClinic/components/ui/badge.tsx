import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type BadgeVariant = 'confirmed' | 'pending' | 'blocking' | 'neutral';

export interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  confirmed: 'bg-[var(--success-100)] text-[var(--success-700)]',
  pending: 'bg-[var(--warning-100)] text-[var(--warning-700)]',
  blocking: 'bg-[var(--danger-100)] text-[var(--danger-700)]',
  neutral: 'bg-[var(--slate-100)] text-[var(--slate-700)]',
};

export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}