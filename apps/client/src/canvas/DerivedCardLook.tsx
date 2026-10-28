import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from '@adecore/ui';
import { accentShades } from '@/canvas/accents';

/* What every card beside a node draws in (`DerivedSet`): a node's frame and header, at the node's sizes. */
export const FRAME = 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-clip-padding shadow-node';
export const HEADER = 'flex h-[39px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-1 pl-3 text-sm text-text';

/* Where a line meets a card, and the node: the middle of a 39px header, which a collapsed card of 40 is all of. */
export const HEADER_MIDDLE = 20;
/* An open card's 39px header and the 1px border above and below it. */
export const CHROME_H = 41;

/* The style of a card's frame beside a colored node, the way that node's own frame wears it. */
export function frameStyle(accent: string | undefined): CSSProperties | undefined {
    return accent === undefined ? undefined : { borderColor: accentShades(accent).frameBorder };
}

/*
 * A collapsed card, which is all header: a press opens it. A colored one is tinted as a colored node's
 * header is, and its icon shows the chevron to open it while the pointer is on the line.
 */
export function CardLine({
    icon,
    accent,
    label,
    onOpen,
    children
}: {
    icon: ReactNode;
    accent: string | undefined;
    /* Its accessible name, when what it draws does not say what opens. */
    label?: string;
    onOpen: () => void;
    children: ReactNode;
}) {
    const shades = accent === undefined ? null : accentShades(accent);
    return (
        <button
            type="button"
            aria-expanded={false}
            aria-label={label}
            className={clsx(
                FRAME,
                'group/header flex-row items-center gap-2 px-3 text-left text-sm text-text',
                shades === null ? 'bg-surface hover:bg-surface-raised' : 'bg-(--run-tint) hover:bg-(--run-hover)'
            )}
            style={
                shades === null ? undefined : ({ borderColor: shades.frameBorder, '--run-tint': shades.header, '--run-hover': shades.hover } as CSSProperties)
            }
            onClick={onOpen}
        >
            <span aria-hidden className="relative flex size-3.5 shrink-0 items-center justify-center text-text-muted">
                <span className="flex transition-opacity group-hover/header:opacity-0">{icon}</span>
                <Icon icon={ChevronRight} size={14} className="absolute opacity-0 transition-opacity group-hover/header:opacity-100" />
            </span>
            {children}
        </button>
    );
}
