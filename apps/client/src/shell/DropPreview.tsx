import { useSyncExternalStore, type CSSProperties } from 'react';
import clsx from 'clsx';
import { dropPreview, subscribeDropPreview } from '@/shell/drop-preview';
import { dropPreviewPath } from '@/shell/tab-drop';

/*
 * Where the dragged view would land: a rectangle for a split or a trade, a tab grown into the cell
 * for a tab. It is one path whose `d` keeps the same commands, so a move from one zone or cell to
 * another, and from a rectangle to a tab, is a transition on `d`. It stands in the layer over the
 * parked pages and in the grid's own coordinates, so no cell clips it and a page never hides it.
 */
export function DropPreview() {
    const { shape, shown, morph } = useSyncExternalStore(subscribeDropPreview, dropPreview);
    const path = shape === null ? null : dropPreviewPath(shape);
    return (
        <svg
            aria-hidden
            className={clsx(
                'pointer-events-none absolute inset-0 size-full overflow-visible transition-opacity duration-100',
                shown ? 'opacity-100' : 'opacity-0'
            )}
        >
            {/* A shape that follows a hidden preview takes its place without moving there from the last drag. */}
            <path
                d={path ?? undefined}
                className={clsx('fill-accent/15 stroke-accent stroke-2', morph && 'transition-[d] duration-150 ease-out')}
                style={path === null ? undefined : ({ d: `path("${path}")` } as CSSProperties)}
            />
        </svg>
    );
}
