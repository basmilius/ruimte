import type { GitDiffScope } from '@ruimte/contracts';
import { create } from 'zustand';

export const DEFAULT_SCOPE: GitDiffScope = 'worktree';

interface GitStore {
    /* What a diff opens in, remembered per project so a branch review stays a branch review. */
    scope: GitDiffScope;
    /* The folders the list has folded up, by their path from the repository root. */
    collapsedDirs: string[];
    /* What the diff of a tab holds, keyed by that tab, so the strip can say it without reading again. */
    counts: Record<string, { added: number; deleted: number }>;
    setScope(scope: GitDiffScope): void;
    setCounts(key: string, counts: { added: number; deleted: number }): void;
    setCollapsedDirs(dirs: string[]): void;
    toggleDir(path: string): void;
}

/*
 * The git panel's own state. It is machine state like the tabs beside it: it travels with the
 * project's local file (`project/panels-port.ts`) and never with the canvas.
 */
export const useGit = create<GitStore>((set, get) => ({
    scope: DEFAULT_SCOPE,
    collapsedDirs: [],
    counts: {},
    setScope(scope) {
        set({ scope });
    },
    setCounts(key, counts) {
        set({ counts: { ...get().counts, [key]: counts } });
    },
    setCollapsedDirs(dirs) {
        set({ collapsedDirs: dirs });
    },
    toggleDir(path) {
        const collapsed = get().collapsedDirs;
        set({ collapsedDirs: collapsed.includes(path) ? collapsed.filter((dir) => dir !== path) : [...collapsed, path] });
    }
}));
