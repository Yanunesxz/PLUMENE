import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'red' | 'green' | 'yellow' | 'gray' | 'brand';

const variantClasses: Record<BadgeVariant, string> = {
  red: 'bg-danger-soft text-danger-soft-foreground',
  green: 'bg-positive-soft text-positive-soft-foreground',
  yellow: 'bg-warn-soft text-warn-soft-foreground',
  gray: 'bg-muted text-muted-foreground',
  brand: 'bg-primary-soft text-primary-soft-foreground',
};

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

export function Badge({ variant = 'gray', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
