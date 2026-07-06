import { clsx } from 'clsx';
import { Info, type LucideIcon } from 'lucide-react';

export type SourceType =
  | 'sample'
  | 'simulated'
  | 'user_input'
  | 'system_analysis'
  | 'confirmed';

export interface SourceChipProps {
  source: SourceType;
  icon?: LucideIcon;
  className?: string;
}

const labelMap: Record<SourceType, string> = {
  sample: '示例内容',
  simulated: '系统预览',
  user_input: '用户输入',
  system_analysis: '系统整理',
  confirmed: '已确认',
};

export function SourceChip({ source, icon: Icon = Info, className }: SourceChipProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]',
        className,
      )}
    >
      <Icon className="h-[11px] w-[11px]" strokeWidth={1.5} />
      {labelMap[source]}
    </span>
  );
}
