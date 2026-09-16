import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { TOOLTIP_KBD } from '@/ui/classes';
import { Kbd } from '@/ui/Kbd';
import type { Shortcut } from '@/ui/shortcut';

interface TileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
    icon: ReactNode;
    title: string;
    /* One short line under the title: where it acts, or why it waits. */
    description?: ReactNode;
    shortcut?: Shortcut;
    /* The one tile a screen leads with. */
    primary?: boolean;
    /* `sm` for a narrow column like the sidebar. */
    size?: 'md' | 'sm';
}

/*
 * One thing to start with, as a card that is a button: the start screen, an empty canvas and the other
 * empty places use it, so a place to begin looks the same wherever it is offered.
 */
export function Tile({ icon, title, description, shortcut, primary = false, size = 'md', className, type = 'button', ...rest }: TileProps) {
    return (
        <button
            type={type}
            className={clsx(
                'flex min-w-0 items-center border bg-surface text-left hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-surface',
                size === 'md' ? 'gap-3 rounded-xl px-4 py-3' : 'gap-2 rounded-lg px-2 py-1.5',
                primary ? 'border-accent' : 'border-border',
                className
            )}
            {...rest}
        >
            <span
                className={clsx(
                    'grid size-8 shrink-0 place-items-center rounded-lg',
                    primary ? 'bg-accent text-accent-text' : 'bg-surface-sunken text-text-muted'
                )}
            >
                {icon}
            </span>
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm font-medium text-text">{title}</span>
                {description && <span className="truncate text-xs text-text-muted">{description}</span>}
            </span>
            {shortcut && <Kbd shortcut={shortcut} className={clsx(TOOLTIP_KBD, 'shrink-0')} />}
        </button>
    );
}
