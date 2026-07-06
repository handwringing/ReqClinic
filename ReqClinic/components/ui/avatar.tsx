import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type AvatarVariant = 'ai' | 'user' | 'neutral';
export type AvatarSize = 24 | 28 | 32 | 40;

export interface AvatarProps {
  variant?: AvatarVariant;
  size?: AvatarSize;
  className?: string;
  children: ReactNode;
}

const variantStyles: Record<AvatarVariant, string> = {
  ai: 'bg-[var(--accent-100)] text-[var(--accent-700)]',
  user: 'bg-[var(--slate-200)] text-[var(--slate-700)]',
  neutral: 'bg-[var(--slate-100)] text-[var(--slate-600)]',
};

export function Avatar({
  variant = 'neutral',
  size = 28,
  className,
  children,
}: AvatarProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-bold select-none leading-none',
        variantStyles[variant],
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {children}
    </span>
  );
}