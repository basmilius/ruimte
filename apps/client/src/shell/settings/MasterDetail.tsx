import type { ReactNode } from 'react';
import clsx from 'clsx';

const LIST_WIDTHS = { 280: 'w-70', 320: 'w-80', 340: 'w-85' } as const;

interface MasterDetailProps {
    /* The column on the left, usually `MasterItem`s under their own headers. */
    list: ReactNode;
    listWidth: keyof typeof LIST_WIDTHS;
    /* Names the list for a screen reader. */
    listLabel: string;
    detail: ReactNode;
}

/*
 * A list beside the detail of what is picked in it, for a pane of many things of one kind (providers,
 * machines, shortcut categories). Each side scrolls on its own, and the detail takes the rest of the
 * width, like a single-column pane. The section id must be `split` in `sections.ts`, so the dialog hands the
 * pane its whole height instead of a padded scrolling column.
 */
export function MasterDetail({ list, listWidth, listLabel, detail }: MasterDetailProps) {
    return (
        <div className="flex min-h-0 min-w-0 grow border-t border-border max-[640px]:flex-col">
            <nav
                aria-label={listLabel}
                className={clsx(
                    'flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 max-[640px]:max-h-60 max-[640px]:w-auto max-[640px]:border-r-0 max-[640px]:border-b',
                    LIST_WIDTHS[listWidth]
                )}
            >
                {list}
            </nav>
            <div className="min-h-0 min-w-0 grow overflow-y-auto">
                <div className="flex min-w-0 flex-col gap-7 px-8 pt-6 pb-10 max-[960px]:px-4">{detail}</div>
            </div>
        </div>
    );
}

interface MasterItemProps {
    selected: boolean;
    onSelect(): void;
    children: ReactNode;
    className?: string;
}

/* One row of the list. The picked one is lifted a shade. */
export function MasterItem({ selected, onSelect, children, className }: MasterItemProps) {
    return (
        <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            className={clsx(
                'flex w-full min-w-0 shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text focus-visible:-outline-offset-2',
                selected ? 'bg-text/5' : 'hover:bg-surface-hover',
                className
            )}
            onClick={onSelect}
        >
            {children}
        </button>
    );
}
