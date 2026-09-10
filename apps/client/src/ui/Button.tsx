import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-text',
    secondary: 'border border-border bg-surface-raised text-text hover:bg-surface-sunken disabled:hover:bg-surface-raised',
    ghost: 'text-text-muted hover:bg-surface-sunken hover:text-text',
    danger: 'bg-status-error text-accent-text'
};

/* 28 and 32 pixels, the two heights the rest of the app already uses for a compact and a normal control. */
const SIZE: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5',
    md: 'h-8 px-3'
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /* Makes it a link that looks like a button: a real anchor, so it opens the way links open. */
    href?: string;
}

/* Every button with a word in it. Icon-only buttons stay `.icon-btn`, which is a square, not a label. */
export function Button({ variant = 'ghost', size = 'md', className, href, type = 'button', ...rest }: ButtonProps) {
    const classes = clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className
    );
    if (href) {
        return <a className={classes} href={href} target="_blank" rel="noreferrer" {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)} />;
    }
    return <button type={type} className={classes} {...rest} />;
}
