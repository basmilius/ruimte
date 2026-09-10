import type { ReactNode } from 'react';
import clsx from 'clsx';

interface PillProps {
    icon?: ReactNode;
    children: ReactNode;
    /* A branch name or a count reads better in the monospace face. */
    mono?: boolean;
    /* With a handler the pill is a button; without one it is a label. */
    onClick?: () => void;
    className?: string;
}

/* The small rounded label in a node header or a sidebar row: a count, a branch, a status. */
export function Pill({ icon, children, mono = false, onClick, className }: PillProps) {
    const shape = clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-text-muted',
        mono && 'font-mono',
        className
    );
    if (!onClick) {
        return (
            <span className={shape}>
                {icon}
                {children}
            </span>
        );
    }
    return (
        <button type="button" className={clsx(shape, 'hover:text-text')} onClick={onClick}>
            {icon}
            {children}
        </button>
    );
}
