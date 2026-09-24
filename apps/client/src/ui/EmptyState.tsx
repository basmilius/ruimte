import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Icon } from '@/ui/Icon';

// One size in a panel, a node and a dialog alike, so no caller picks its own.
const ICON_SIZE = 20;

interface EmptyStateProps {
    /* A Lucide icon, or a mark of another kind (a provider's logo) that takes a `size`. */
    icon?: LucideIcon | ReactElement<{ size?: number }>;
    spin?: boolean;
    /* A heading above the sentence, for a state that is an outcome rather than a list with nothing in it. */
    title?: ReactNode;
    /* One sentence. What is missing, and what puts something there. */
    children: ReactNode;
    /* The button or the shortcut that fills the space; kept to one. */
    action?: ReactNode;
    className?: string;
}

/* What a list, a canvas or a thread shows before it holds anything. */
export function EmptyState({ icon, spin = false, title, children, action, className }: EmptyStateProps) {
    return (
        <div className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-8 text-center', className)}>
            {icon && (
                <span className="text-text-faint">
                    {isValidElement(icon) ? (
                        cloneElement(icon, { size: ICON_SIZE })
                    ) : (
                        <Icon icon={icon} size={ICON_SIZE} className={spin ? 'animate-spin' : undefined} />
                    )}
                </span>
            )}
            {title && <p className="text-sm font-medium text-text">{title}</p>}
            <p className="max-w-[280px] text-xs leading-snug text-text-muted">{children}</p>
            {/* The button is an answer to the sentence, not a third line of it. */}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}
