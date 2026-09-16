import type { ReactNode } from 'react';
import clsx from 'clsx';

interface PillProps {
    icon?: ReactNode;
    children: ReactNode;
    /* A branch name or a count reads better in the monospace face. */
    mono?: boolean;
    /* Lifted off a sunken header, for a pill that should stand out as a control. */
    raised?: boolean;
    /* With a handler the pill is a button; without one it is a label. */
    onClick?: () => void;
    className?: string;
}

/* The small rounded label in a node header or a sidebar row: a count, a branch, a status. */
export function Pill({ icon, children, mono = false, raised = false, onClick, className }: PillProps) {
    const shape = clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs text-text-muted',
        raised ? 'bg-surface-active' : 'bg-surface-sunken',
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
