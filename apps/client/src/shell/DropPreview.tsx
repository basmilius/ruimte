import { DropPreview as SharedDropPreview } from '@adecore/ui';
import clsx from 'clsx';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dropPreview, subscribeDropPreview } from '@/shell/drop-preview';

/*
 * Where the dragged view would land: a rectangle for a split or a trade, a tab grown into the cell
 * for a tab. It is drawn in the grid's own coordinates, over the parked pages, so no cell clips it and
 * a page never hides it. It stands on the body rather than in the grid, since the tab of a lone cell
 * grows out of the top row above the grid. It keeps its shape while it fades out.
 */
export function DropPreview() {
    const { shape, shown, morph } = useSyncExternalStore(subscribeDropPreview, dropPreview);
    // Read as the shape changes, which a drag does on every move: the grid only moves with the window.
    const grid = shape === null ? null : (document.querySelector('[data-split-grid]')?.getBoundingClientRect() ?? null);

    if (grid === null) {
        return null;
    }

    return createPortal(
        <div
            className="pointer-events-none fixed z-30"
            style={{ left: Math.round(grid.left), top: Math.round(grid.top), width: Math.round(grid.width), height: Math.round(grid.height) }}
        >
            <SharedDropPreview
                shape={shape}
                className={clsx(
                    'transition-opacity duration-100',
                    shown ? 'opacity-100' : 'opacity-0',
                    // A shape that follows a hidden preview takes its place without moving there from the last drag.
                    !morph && '[&_path]:transition-none'
                )}
            />
        </div>,
        document.body
    );
}
