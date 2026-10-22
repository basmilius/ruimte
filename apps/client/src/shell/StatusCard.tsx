import type { ReactNode } from 'react';
import { CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';
import { Icon } from '@adecore/ui';

interface StatusCardProps {
    glyph: ReactNode;
    title: string;
    /* The line under the title: the machine a project is on, or when a machine was last seen. */
    meta?: ReactNode;
    line: string;
    failed: boolean;
    /* Stands in for the spinner, for a window that is not waiting on anything. */
    icon?: LucideIcon;
    children?: ReactNode;
}

/* The card the window shows while it waits on a machine or after one failed it: what, where, why, and what to do. */
export function StatusCard({ glyph, title, meta, line, failed, icon, children }: StatusCardProps) {
    return (
        <div className="flex w-80 max-w-full flex-col items-center gap-3 px-6 text-center">
            {glyph}
            <div className="flex max-w-full flex-col items-center gap-1">
                <span className="max-w-full truncate text-sm font-medium text-text">{title}</span>
                {meta}
            </div>
            <p className="flex items-start gap-2 text-xs leading-snug text-text-muted">
                <Icon
                    icon={failed ? CircleAlert : (icon ?? LoaderCircle)}
                    size={14}
                    className={failed ? 'mt-px shrink-0 text-status-error' : icon ? 'mt-px shrink-0' : 'mt-px shrink-0 animate-spin'}
                />
                <span>{line}</span>
            </p>
            {children && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>}
        </div>
    );
}
