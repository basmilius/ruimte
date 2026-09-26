import type { ReactNode } from 'react';
import clsx from 'clsx';

/* What the label says about the thing it names, drawn as its ground. */
const TONES = {
    muted: 'bg-surface-sunken text-text-muted',
    /* Lifted off a sunken header, for a label that should stand out as a control. */
    raised: 'bg-surface-active text-text-muted',
    idle: 'bg-status-idle/15 text-status-idle',
    needsYou: 'bg-status-needs-you/15 text-status-needs-you',
    accent: 'bg-accent-soft text-accent'
};

/* A pill rides in a header or a row; a tag sits at the end of a line of prose, tighter and bolder. */
const SHAPES = {
    pill: 'rounded-full px-2 py-0.5',
    tag: 'rounded-md px-1.5 py-0.5 font-medium'
};

interface PillProps {
    icon?: ReactNode;
    children: ReactNode;
    tone?: keyof typeof TONES;
    shape?: keyof typeof SHAPES;
    /* A branch name or a count reads better in the monospace face. */
    mono?: boolean;
    /* With a handler the pill is a button; without one it is a label. */
    onClick?: () => void;
    className?: string;
}

/* The small rounded label in a node header, a sidebar row or a settings line: a count, a branch, a status. */
export function Pill({ icon, children, tone = 'muted', shape = 'pill', mono = false, onClick, className }: PillProps) {
    const shared = clsx('inline-flex shrink-0 items-center gap-1 text-xs', SHAPES[shape], TONES[tone], mono && 'font-mono', className);
    if (!onClick) {
        return (
            <span className={shared}>
                {icon}
                {children}
            </span>
        );
    }
    return (
        <button type="button" className={clsx(shared, 'hover:text-text')} onClick={onClick}>
            {icon}
            {children}
        </button>
    );
}
