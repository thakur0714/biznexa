import Link from 'next/link';
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'ink' | 'outline' | 'ghost';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-marigold text-night hover:bg-marigold-600 font-semibold',
  ink: 'bg-ink text-white hover:bg-ink-600 font-semibold',
  outline: 'border border-rule bg-white text-night hover:border-ink font-medium',
  ghost: 'text-ink hover:bg-ink-050 font-medium',
};

const sizes = {
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-13 px-7 text-base',
  sm: 'h-9 px-3.5 text-sm',
};

export type ButtonSize = keyof typeof sizes;

/** Button classes, for elements that must look like a button but are not one (e.g. a plain `<a>`). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant = 'primary', size = 'md', className = '', ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
