import type { GitDiffScope, ProjectFileTabView } from '@ruimte/contracts';
import { create } from 'zustand';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { textDrafts } from '@/state/text-drafts';
import { useUi } from '@/state/ui';

export type FileTabView = ProjectFileTabView;

export interface FileTab {
    /* What names this tab among the others: the path, `diff:` and the path for a diff tab, or
       `commit:` and the hash for a whole commit. */
    key: string;
    /* Absolute on the daemon's machine, the same path `fs.reveal` and the viewer take. */
    path: string;
    /* Absent for the file itself; a diff of the same file is a tab of its own next to it. */
    view?: FileTabView;
    /* A pinned tab survives the limit; double-click on a tab sets it. */
    pinned: boolean;
}

export interface TabState {
    tabs: FileTab[];
    active: string | null;
}

/* A base diff of the checkout itself rather than of a file in it: everything a worktree holds over where it came from. */
export const isCheckoutDiff = (path: string, view: FileTabView | undefined): boolean =>
    view !== undefined && view.commit === undefined && view.scope === 'base' && path === view.cwd;

/*
 * A file and its diff are two tabs of one path, so the view is part of what names them apart. A
 * commit is named after the commit and not after the path, because two commits of one repository
 * would otherwise be one tab.
 */
export const tabKey = (path: string, view?: FileTabView): string => {
    if (view?.commit !== undefined) {
        return `commit:${view.commit}`;
    }
    if (isCheckoutDiff(path, view)) {
        return `checkout:${path}`;
    }
    return view ? `diff:${path}` : path;
};

/*
 * A tab per open file, the way a preview tab works in an editor: the oldest unpinned one makes room
 * when the limit is reached. The tab that is open right now is never the one that goes, or opening
 * a file could close the file it just opened, and neither is one `keeps` holds on to, such as a file
 * with unsaved changes.
 */
export const openTab = (state: TabState, path: string, limit: number, view?: FileTabView, keeps: (tab: FileTab) => boolean = () => false): TabState => {
    const key = tabKey(path, view);
    const open = state.tabs.find((tab) => tab.key === key);
    if (open) {
        // A diff tab that is open again asks for another scope, so the tab follows, it is not opened twice.
        const tabs = view === undefined ? state.tabs : state.tabs.map((tab) => (tab.key === key ? { ...tab, view } : tab));
        return { tabs, active: key };
    }
    if (view) {
        /* Changes share one tab, the way a review pane works: the next change opens in the diff tab
           nobody pinned, and only a pin makes a diff stay while another one is looked at. */
        const reused = state.tabs.findIndex((tab) => tab.view !== undefined && !tab.pinned);
        if (reused >= 0) {
            const tabs = [...state.tabs];
            tabs[reused] = { key, path, view, pinned: false };
            return { tabs, active: key };
        }
    }
    const tabs = [...state.tabs, { key, path, ...(view ? { view } : {}), pinned: false }];
    while (tabs.length > Math.max(1, limit)) {
        const index = tabs.findIndex((tab) => !tab.pinned && tab.key !== key && !keeps(tab));
        if (index < 0) {
            break;
        }
        tabs.splice(index, 1);
    }
    return { tabs, active: key };
};

/* The neighbor takes over when the active tab closes: the one to its right, or the one before it. */
export const closeTab = (state: TabState, key: string): TabState => {
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) {
        return state;
    }
    const tabs = state.tabs.filter((tab) => tab.key !== key);
    if (state.active !== key) {
        return { tabs, active: state.active };
    }
    return { tabs, active: tabs[Math.min(index, tabs.length - 1)]?.key ?? null };
};

export const pinTab = (state: TabState, key: string, pinned: boolean): TabState => ({
    tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, pinned } : tab)),
    active: state.active
});

export interface RevealLineRequest {
    /* The tab this is about; a file that is not the one up ignores it. */
    key: string;
    /* One-based, the number the viewer puts in its gutter. */
    line: number;
    /* Goes up on every ask, so the same line twice is two jumps. */
    nonce: number;
}

export interface RevealRequest {
    /* Absolute on the daemon's machine, the same path a tab carries. */
    path: string;
    /* Goes up on every ask, so revealing the same file twice is two reveals and not one. */
    nonce: number;
}

/* How many closed files the empty preview offers to open again. */
export const RECENT_FILES_LIMIT = 5;

/* A file tab that closed goes on top of the files to open again; a diff or a commit is not a file to go back to. */
export const rememberClosed = (recent: readonly string[], tab: FileTab | undefined): string[] =>
    tab === undefined || tab.view !== undefined ? [...recent] : [tab.path, ...recent.filter((path) => path !== tab.path)].slice(0, RECENT_FILES_LIMIT);

interface FilesStore extends TabState {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* Files of this project closed in this session, newest first. Not saved: the tabs that are open are what the project keeps. */
    recent: string[];
    /* Counts the files opened by hand. The files cell watches it to take the keyboard, so the tab
       that just opened answers to ⌘W. Restoring a project does not count: nothing was asked for. */
    focusRequest: number;
    /* The directories the tree has open, the way the tree names one: relative, POSIX, trailing slash. */
    expandedDirs: string[];
    /* What the files panel was asked to bring into view, from a menu somewhere else in the app. */
    reveal: RevealRequest | null;
    /* The line the viewer was asked to jump to, from a file reference that named one. */
    revealLine: RevealLineRequest | null;
    load(projectId: string | null, state: TabState & { expandedDirs: string[] }): void;
    open(path: string, limit: number, view?: FileTabView, line?: number): void;
    close(key: string): void;
    closeOthers(key: string): void;
    closeAll(): void;
    setPinned(key: string, pinned: boolean): void;
    setScope(key: string, scope: GitDiffScope): void;
    setStaged(key: string, staged: boolean): void;
    revealInFiles(path: string): void;
    activate(key: string): void;
    setExpandedDirs(dirs: string[]): void;
}

/*
 * Which files the viewer has open and what the tree has unfolded. Machine state: it travels with
 * the project's local file on this machine (`project/panels-port.ts`), never in `project.json`, so
 * another person opening the same canvas gets none of it.
 */
export const useFiles = create<FilesStore>((set, get) => ({
    projectId: null,
    recent: [],
    focusRequest: 0,
    tabs: [],
    active: null,
    expandedDirs: [],
    reveal: null,
    revealLine: null,
    load(projectId, state) {
        set({ projectId, tabs: state.tabs, active: state.active, expandedDirs: state.expandedDirs, reveal: null, revealLine: null, recent: [] });
    },
    /* A tab and the cell that draws it are one thing to the person opening a file: the first open
       puts the files on the grid, beside whatever they were working in, and the last close takes
       the cell away again. */
    open(path, limit, view, line) {
        const reveal = line === undefined ? get().revealLine : { key: tabKey(path, view), line, nonce: (get().revealLine?.nonce ?? 0) + 1 };
        const endpointId = currentEndpointId();
        const unsaved = (tab: FileTab): boolean => tab.view === undefined && textDrafts.isUnsaved(endpointId, tab.path);
        set({ ...openTab(get(), path, limit, view, unsaved), focusRequest: get().focusRequest + 1, revealLine: reveal });
        useDocument.getState().showFiles();
    },
    /* A file with unsaved changes is saved first, and closes once it is (`unsaved-close.ts`). */
    close(key) {
        const tab = get().tabs.find((entry) => entry.key === key);
        const closeNow = (): void => {
            const next = closeTab(get(), key);
            set({
                ...next,
                recent: rememberClosed(
                    get().recent,
                    get().tabs.find((entry) => entry.key === key)
                )
            });
            if (next.tabs.length === 0) {
                useDocument.getState().hideFiles();
            }
        };
        closeAfterSaving(currentEndpointId(), tab === undefined || tab.view !== undefined ? [] : [tab.path], closeNow);
    },
    /* A pinned tab goes with the rest, since the person asked for this one file and nothing else. */
    closeOthers(key) {
        for (const tab of get().tabs) {
            if (tab.key !== key) {
                get().close(tab.key);
            }
        }
    },
    closeAll() {
        for (const tab of get().tabs) {
            get().close(tab.key);
        }
    },
    setPinned(key, pinned) {
        set(pinTab(get(), key, pinned));
    },
    setScope(key, scope) {
        set({ tabs: get().tabs.map((tab) => (tab.key === key && tab.view ? { ...tab, view: { ...tab.view, scope } } : tab)) });
    },
    /* Staging a file from its own diff moves the tab to the side of the index it now sits on. */
    setStaged(key, staged) {
        set({ tabs: get().tabs.map((tab) => (tab.key === key && tab.view ? { ...tab, view: { ...tab.view, staged } } : tab)) });
    },
    /* The files panel listens for this; it comes up if it was closed, the way opening a file brings
       the files cell onto the grid. */
    revealInFiles(path) {
        useUi.getState().setPanel({ open: true, kind: 'files' });
        set({ reveal: { path, nonce: (get().reveal?.nonce ?? 0) + 1 } });
    },
    activate(key) {
        set({ active: key });
    },
    setExpandedDirs(dirs) {
        set({ expandedDirs: dirs });
    }
}));
