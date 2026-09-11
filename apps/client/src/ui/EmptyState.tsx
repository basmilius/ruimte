import type { ReactNode } from 'react';
import clsx from 'clsx';

interface EmptyStateProps {
    icon?: ReactNode;
    /* One sentence. What is missing, and what puts something there. */
    children: ReactNode;
    /* The button or the chord that fills the space; kept to one. */
    action?: ReactNode;
    className?: string;
}

/* What a list, a canvas or a thread shows before it holds anything. */
export function EmptyState({ icon, children, action, className }: EmptyStateProps) {
    return (
        <div className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-8 text-center', className)}>
            {icon && <span className="text-text-faint">{icon}</span>}
            <p className="max-w-[280px] text-xs leading-snug text-text-muted">{children}</p>
            {/* The button is an answer to the sentence, not a third line of it. */}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}
