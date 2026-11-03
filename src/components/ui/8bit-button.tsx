import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Chunky 8-bit button: pixel font, notched pixel border, press-down on click. */
export const buttonVariants = cva(
  'pixel-btn retro relative m-1 inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap uppercase transition-transform duration-75 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110 [--pb:#dbeafe]',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-[#32323c] [--pb:#8a8a94]',
        outline: 'bg-transparent text-foreground hover:bg-secondary [--pb:var(--border-ui)]',
        xp: 'bg-xp text-accent-foreground hover:brightness-110 [--pb:#ffe7a3]',
        destructive: 'bg-destructive text-white hover:brightness-110 [--pb:#ffc2c4]',
        ghost: 'bg-transparent text-foreground shadow-none hover:bg-secondary',
      },
      size: {
        sm: 'h-8 px-3 text-[10px]',
        default: 'h-11 px-5 text-xs',
        lg: 'h-14 px-6 text-sm',
        icon: 'size-10 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
