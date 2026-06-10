import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'red' | 'green' | 'yellow' | 'gray' | 'blue' | 'brand';

const variantClasses: Record<BadgeVariant, string> = {
  red: 'bg-red-100 text-red-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-800',
  gray: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-100 text-blue-700',
  brand: 'bg-brand-100 text-brand-700',
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
