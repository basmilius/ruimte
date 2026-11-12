import { clampColumnSize } from '@adecore/ui';
import { useUi } from '@/state/ui';
import { useWindowWidth } from '@/surface/useWindowWidth';

/* How wide the list is when it is open, until a person drags it. The inner column keeps its width while the
   wrapper animates to zero, so nothing reflows on the way out, and the toolbar draws the glow this wide where it was. */
const SIDEBAR_WIDTH_PX = 248;

// The canvas beside the list keeps room to work in, however wide the list is dragged.
const MIN_CANVAS_WIDTH = 360;

function maxWidth(windowWidth: number): number {
    return Math.max(200, Math.min(480, windowWidth - MIN_CANVAS_WIDTH));
}

export const SIDEBAR_BOUNDS = { min: 200, max: () => maxWidth(window.innerWidth) };

/* The width the list stands at, clamped, since the window may be narrower than when it was dragged. */
export function useSidebarWidth(): number {
    const windowWidth = useWindowWidth();
    const stored = useUi((state) => state.sidebarWidth) ?? SIDEBAR_WIDTH_PX;

    return clampColumnSize({ min: SIDEBAR_BOUNDS.min, max: () => maxWidth(windowWidth) }, stored);
}
