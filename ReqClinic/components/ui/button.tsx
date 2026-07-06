import { clsx } from 'clsx';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonSize = 'regular' | 'compact' | 'large';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  children?: ReactNode;
}

const sizeStyles: Record<ButtonSize, string> = {
  regular: 'h-[36px] px-3 text-sm',
  compact: 'h-[32px] px-2.5 text-xs',
  large: 'h-[40px] px-4 text-base',
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-500)] text-white hover:bg-[var(--accent-600)] border border-transparent',
  secondary:
    'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-hover)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)]',
  danger:
    'bg-[var(--danger-700)] text-white hover:opacity-90 border border-transparent',
};

export function Button({
  variant = 'primary',
  size = 'regular',
  loading = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-normal',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sizeStyles[size],
        variantStyles[variant],
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />}
      {!loading && LeftIcon && <LeftIcon className="h-4 w-4" strokeWidth={1.5} />}
      {children}
      {!loading && RightIcon && <RightIcon className="h-4 w-4" strokeWidth={1.5} />}
    </button>
  );
}
