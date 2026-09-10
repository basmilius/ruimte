import type { GitDiffScope } from '@ruimte/contracts';
import { create } from 'zustand';

export const DEFAULT_SCOPE: GitDiffScope = 'worktree';

// What the commit log takes at the bottom of the panel until a drag gives the project its own.
export const DEFAULT_LOG_HEIGHT = 200;

interface GitStore {
    /* What a diff opens in, remembered per project so a branch review stays a branch review. */
    scope: GitDiffScope;
    /* The folders the list has folded up, by their path from the repository root. */
    collapsedDirs: string[];
    /* What the diff of a tab holds, keyed by that tab, so the strip can say it without reading again. */
    counts: Record<string, { added: number; deleted: number }>;
    /* Whole pixels the commit log takes; it travels with the project like the widths beside it. */
    logHeight: number;
    /* The commit message being written, per checkout, so switching panels does not throw it away.
       It stays in memory: a half-written message is not something to find back after a reload. */
    messages: Record<string, string>;
    setScope(scope: GitDiffScope): void;
    setLogHeight(height: number): void;
    setMessage(cwd: string, message: string): void;
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
    logHeight: DEFAULT_LOG_HEIGHT,
    messages: {},
    setScope(scope) {
        set({ scope });
    },
    setLogHeight(height) {
        set({ logHeight: Math.round(height) });
    },
    setMessage(cwd, message) {
        set({ messages: { ...get().messages, [cwd]: message } });
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
