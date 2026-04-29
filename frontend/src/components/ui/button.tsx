import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-[color:var(--accent-contrast)] hover:bg-[color:var(--accent-2)]',
        ghost: 'bg-transparent text-text-soft hover:bg-surface-2 hover:text-text',
        subtle: 'bg-surface-2 text-text hover:bg-surface-3',
        outline: 'border border-border-strong bg-transparent text-text hover:bg-surface-2',
        destructive: 'bg-[color:var(--danger)] text-white hover:opacity-90'
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0'
      }
    },
    defaultVariants: { variant: 'ghost', size: 'md' }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);

Button.displayName = 'Button';

export { buttonVariants };
