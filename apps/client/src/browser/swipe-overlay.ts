import { create } from 'zustand';
import type { SwipeSide } from '@/browser/swipe';

/* The arrow over one page. `shown` false keeps the side and the progress it had, so it fades out from there. */
export interface SwipeArrowState {
    side: SwipeSide;
    progress: number;
    shown: boolean;
}

interface SwipeOverlayStore {
    /* Keyed with `endpointKey`, like the pages themselves. */
    byKey: Record<string, SwipeArrowState>;
    show(key: string, side: SwipeSide, progress: number): void;
    hide(key: string): void;
    forget(key: string): void;
}

/*
 * A store of its own rather than a field of `useBrowser`: a swipe writes a sample every 16 ms, and
 * `WebviewParking` places every page whenever the browser store moves. Only the arrow of the page
 * being swiped reads a row here.
 */
export const useSwipeOverlay = create<SwipeOverlayStore>((set) => ({
    byKey: {},
    show(key, side, progress) {
        set((s) => ({ byKey: { ...s.byKey, [key]: { side, progress, shown: true } } }));
    },
    hide(key) {
        set((s) => {
            const current = s.byKey[key];
            if (!current?.shown) {
                return s;
            }
            return { byKey: { ...s.byKey, [key]: { ...current, shown: false } } };
        });
    },
    forget(key) {
        set((s) => {
            if (!(key in s.byKey)) {
                return s;
            }
            const next = { ...s.byKey };
            delete next[key];
            return { byKey: next };
        });
    }
}));
