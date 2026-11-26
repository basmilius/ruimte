import { create } from 'zustand';
import type { WindowItem } from './messages';

interface PendingViews {
    /* The views an auxiliary window waits for while the drag that opened it is under way. */
    items: readonly WindowItem[];
    set(items: readonly WindowItem[]): void;
}

export const usePendingViews = create<PendingViews>((set) => ({
    items: [],
    set(items) {
        set({ items });
    }
}));
