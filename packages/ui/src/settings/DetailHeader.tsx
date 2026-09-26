import type { ReactNode } from 'react';

/* The head of a detail: a mark, the name, a line under it, and the actions of the thing. */
export function DetailHeader({ mark, title, subtitle, actions }: { mark: ReactNode; title: string; subtitle: ReactNode; actions?: ReactNode }) {
    return (
        <header className="flex min-w-0 flex-wrap items-start gap-3">
            {mark}
            <div className="min-w-0 grow basis-48">
                <h3 className="truncate text-lg font-semibold text-text">{title}</h3>
                <div className="flex min-w-0 items-center gap-1.5 text-xs break-words text-text-muted">{subtitle}</div>
            </div>
            {actions}
        </header>
    );
}

/* The red outline of a step that forgets something, softer than the filled button of a deletion that cannot come back. */
export const REMOVE_BUTTON =
    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-status-error/35 px-3 text-xs font-medium text-status-error hover:bg-status-error/10 disabled:opacity-40 disabled:hover:bg-transparent';
