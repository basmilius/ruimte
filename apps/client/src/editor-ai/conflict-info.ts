import { create } from 'zustand';
import type { ConflictAuthor } from './conflict-resolution';

export interface ConflictInfo {
    /* The blocks still waiting for an answer. */
    open: number;
    /* Who wrote the newest part of the incoming text, when the runs of the file say. */
    author: ConflictAuthor | null;
}

interface ConflictInfoStore {
    /* Per machine and absolute path (`state/keys.ts`), as the drafts are. */
    rows: Record<string, ConflictInfo>;
    set(key: string, info: ConflictInfo | null): void;
    forget(key: string): void;
}

/* What the bar over an editor says about the review under way in it. */
export const useConflictInfo = create<ConflictInfoStore>((set) => ({
    rows: {},
    set: (key, info) =>
        set((state) => {
            if (info === null) {
                return state.rows[key] === undefined ? state : { rows: Object.fromEntries(Object.entries(state.rows).filter(([other]) => other !== key)) };
            }
            return { rows: { ...state.rows, [key]: info } };
        }),
    forget: (key) => useConflictInfo.getState().set(key, null)
}));
