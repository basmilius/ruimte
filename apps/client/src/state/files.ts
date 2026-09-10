import type { GitDiffScope, ProjectFileTabView } from '@ruimte/contracts';
import { create } from 'zustand';
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
    /* Reserved for an editor: the dot's place in the tab is already there. */
    dirty: boolean;
}

export interface TabState {
    tabs: FileTab[];
    active: string | null;
}

/*
 * A file and its diff are two tabs of one path, so the view is part of what names them apart. A
 * commit is named after the commit and not after the path, because two commits of one repository
 * would otherwise be one tab.
 */
export const tabKey = (path: string, view?: FileTabView): string => {
    if (view?.commit !== undefined) {
        return `commit:${view.commit}`;
    }
    return view ? `diff:${path}` : path;
};

/*
 * A tab per open file, the way a preview tab works in an editor: the oldest unpinned one makes room
 * when the limit is reached. The tab that is open right now is never the one that goes, or opening
 * a file could close the file it just opened.
 */
export const openTab = (state: TabState, path: string, limit: number, view?: FileTabView): TabState => {
    const key = tabKey(path, view);
    const open = state.tabs.find((tab) => tab.key === key);
    if (open) {
        // A diff tab that is open again asks for another scope: the tab follows, it is not opened twice.
        const tabs = view === undefined ? state.tabs : state.tabs.map((tab) => (tab.key === key ? { ...tab, view } : tab));
        return { tabs, active: key };
    }
    if (view) {
        /* Changes share one tab, the way a review pane works: the next change opens in the diff tab
           nobody pinned, and only a pin makes a diff stay while another one is looked at. */
        const reused = state.tabs.findIndex((tab) => tab.view !== undefined && !tab.pinned);
        if (reused >= 0) {
            const tabs = [...state.tabs];
            tabs[reused] = { key, path, view, pinned: false, dirty: false };
            return { tabs, active: key };
        }
    }
    const tabs = [...state.tabs, { key, path, ...(view ? { view } : {}), pinned: false, dirty: false }];
    while (tabs.length > Math.max(1, limit)) {
        const index = tabs.findIndex((tab) => !tab.pinned && tab.key !== key);
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

interface FilesStore extends TabState {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* The directories the tree has open, the way the tree names one: relative, POSIX, trailing slash. */
    expandedDirs: string[];
    load(projectId: string | null, state: TabState & { expandedDirs: string[] }): void;
    open(path: string, limit: number, view?: FileTabView): void;
    close(key: string): void;
    setPinned(key: string, pinned: boolean): void;
    setScope(key: string, scope: GitDiffScope): void;
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
    tabs: [],
    active: null,
    expandedDirs: [],
    load(projectId, state) {
        set({ projectId, tabs: state.tabs, active: state.active, expandedDirs: state.expandedDirs });
    },
    /* A tab and the panel that draws it are one thing to the person opening a file: the first open
       brings the preview up and the last close takes it away again. */
    open(path, limit, view) {
        set(openTab(get(), path, limit, view));
        useUi.getState().setPreviewOpen(true);
    },
    close(key) {
        const next = closeTab(get(), key);
        set(next);
        if (next.tabs.length === 0) {
            useUi.getState().setPreviewOpen(false);
        }
    },
    setPinned(key, pinned) {
        set(pinTab(get(), key, pinned));
    },
    setScope(key, scope) {
        set({ tabs: get().tabs.map((tab) => (tab.key === key && tab.view ? { ...tab, view: { ...tab.view, scope } } : tab)) });
    },
    activate(key) {
        set({ active: key });
    },
    setExpandedDirs(dirs) {
        set({ expandedDirs: dirs });
    }
}));
