import type { GitDiffScope } from '@ruimte/contracts';
import { create } from 'zustand';

export const DEFAULT_SCOPE: GitDiffScope = 'worktree';

// What the commit log takes at the bottom of the panel until a drag gives the project its own.
export const DEFAULT_LOG_HEIGHT = 200;

// The file tree of a commit tab, until a drag gives it a width of its own.
export const DEFAULT_COMMIT_TREE_WIDTH = 240;

interface GitStore {
    /* What a diff opens in, remembered per project so a branch review stays a branch review. */
    scope: GitDiffScope;
    /* Persisted folder keys include the checkout path and file group. */
    collapsedDirs: string[];
    /* The repositories of the folder a person folded away, by label. */
    hiddenRepos: string[];
    /* What the diff of a tab holds, keyed by that tab, so the strip can say it without reading again. */
    counts: Record<string, { added: number; deleted: number }>;
    /* The file a commit tab shows, keyed by that tab, so switching tabs comes back to it. */
    commitFiles: Record<string, string>;
    /* Whole pixels the file tree of a commit tab takes, the same in every one of them for as long as the window stays. */
    commitTreeWidth: number;
    /* Whole pixels the commit log takes; it travels with the project like the widths beside it. */
    logHeight: number;
    /* The commit message being written, per project, since one message commits whatever is staged and
       that can be more than one repository. It stays in memory: a half-written message is not
       something to find back after a reload. */
    messages: Record<string, string>;
    setScope(scope: GitDiffScope): void;
    toggleRepo(label: string): void;
    setHiddenRepos(labels: string[]): void;
    setLogHeight(height: number): void;
    setMessage(cwd: string, message: string): void;
    setCounts(key: string, counts: { added: number; deleted: number }): void;
    setCommitFile(key: string, path: string): void;
    setCommitTreeWidth(width: number): void;
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
    hiddenRepos: [],
    counts: {},
    commitFiles: {},
    commitTreeWidth: DEFAULT_COMMIT_TREE_WIDTH,
    logHeight: DEFAULT_LOG_HEIGHT,
    messages: {},
    setScope(scope) {
        set({ scope });
    },
    toggleRepo(label) {
        const hidden = get().hiddenRepos;
        set({ hiddenRepos: hidden.includes(label) ? hidden.filter((entry) => entry !== label) : [...hidden, label] });
    },
    setHiddenRepos(labels) {
        set({ hiddenRepos: labels });
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
    setCommitFile(key, path) {
        if (get().commitFiles[key] === path) {
            return;
        }
        set({ commitFiles: { ...get().commitFiles, [key]: path } });
    },
    setCommitTreeWidth(width) {
        set({ commitTreeWidth: Math.round(width) });
    },
    setCollapsedDirs(dirs) {
        set({ collapsedDirs: dirs });
    },
    toggleDir(path) {
        const collapsed = get().collapsedDirs;
        set({ collapsedDirs: collapsed.includes(path) ? collapsed.filter((dir) => dir !== path) : [...collapsed, path] });
    }
}));
