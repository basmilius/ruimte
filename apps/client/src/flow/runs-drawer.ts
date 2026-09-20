import { create } from 'zustand';

/* A few rows of runs, which is enough to see the last handful without covering the worksheet. */
export const DEFAULT_RUNS_HEIGHT = 220;
export const MIN_RUNS_HEIGHT = 120;

/* How much worksheet stays above the drawer, whatever a person drags it to. */
export const MIN_WORKSHEET_HEIGHT = 200;

const HEIGHT_KEY = 'ruimte.flow.runsHeight';

const readHeight = (): number => {
    try {
        const stored = Number.parseInt(localStorage.getItem(HEIGHT_KEY) ?? '', 10);
        return Number.isFinite(stored) && stored >= MIN_RUNS_HEIGHT ? stored : DEFAULT_RUNS_HEIGHT;
    } catch {
        return DEFAULT_RUNS_HEIGHT;
    }
};

const persistHeight = (height: number): void => {
    try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
    } catch {
        // Storage that refuses keeps the drawer at this height for this session only.
    }
};

interface RunsDrawerState {
    open: boolean;
    height: number;
    setOpen(open: boolean): void;
    toggle(): void;
    setHeight(height: number): void;
}

/*
 * The drawer under a worksheet: whether it is out and how tall it is. Both belong to this client and
 * not to the project's file. A height is what one screen has room for, and whether the list is open
 * is what a person is doing right now, neither of which travels with a flow.
 */
export const useRunsDrawer = create<RunsDrawerState>((set, get) => ({
    open: false,
    height: readHeight(),
    setOpen(open) {
        set({ open });
    },
    toggle() {
        set({ open: !get().open });
    },
    setHeight(height) {
        persistHeight(height);
        set({ height });
    }
}));
