import type { Worktree } from '@ruimte/contracts';
import { create } from 'zustand';

interface FilesRootStore {
    /* The worktree the files panel was pointed at, per machine and project folder. Not saved: a
       window that opens again starts in the project. */
    picked: Record<string, string>;
    pick(key: string, worktree: string | null): void;
}

export const useFilesRoot = create<FilesRootStore>((set, get) => ({
    picked: {},
    pick(key, worktree) {
        const { [key]: _left, ...rest } = get().picked;
        set({ picked: worktree === null ? rest : { ...rest, [key]: worktree } });
    }
}));

interface FilesRoot {
    /* The folder the tree lists. */
    root: string;
    /* The worktree that folder is, or null for the project folder. */
    worktree: Worktree | null;
}

/* Where the files panel stands: the picked worktree while the machine still lists it with its folder, else the project folder. */
export function filesRootOf(folder: string, picked: string | null, worktrees: readonly Worktree[]): FilesRoot {
    const worktree = picked === null ? undefined : worktrees.find((entry) => entry.path === picked && entry.missing !== true);
    return worktree === undefined ? { root: folder, worktree: null } : { root: worktree.path, worktree };
}
