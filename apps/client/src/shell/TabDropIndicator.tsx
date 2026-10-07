import type { CSSProperties } from 'react';
import { DROP_STROKE, TAB_RADIUS, TAB_TOP_INSET, tabDropPath, type TabDrop } from '@/shell/tab-drop';

/*
 * A tab standing in the bar, grown together with the body of the cell under it: "this becomes a tab".
 * It has the fill and the stroke of the indicator for a split. It starts at the top of the bar, which is
 * above the box of the cell's body, so it goes in the overlay's `drop` slot, the one that is not clipped.
 * The path is also set as the CSS `d`, which is what lets the tab slide between gaps.
 */
export function TabDropIndicator({ drop }: { drop: TabDrop }) {
    const path = tabDropPath({
        width: drop.width,
        height: drop.height,
        barHeight: drop.barHeight,
        tabLeft: drop.left,
        tabWidth: drop.tabWidth,
        tabTop: TAB_TOP_INSET,
        radius: TAB_RADIUS,
        inset: DROP_STROKE / 2
    });
    return (
        <svg
            aria-hidden
            width={drop.width}
            height={drop.height}
            className="pointer-events-none absolute left-0 overflow-visible"
            style={{ top: -drop.barHeight }}
        >
            <path d={path} className="fill-accent/15 stroke-accent stroke-2 transition-[d] duration-100" style={{ d: `path("${path}")` } as CSSProperties} />
        </svg>
    );
}
