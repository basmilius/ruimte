import { create } from 'zustand';
import { useUi } from '@/state/ui';

export interface FileTab {
    /* Absolute on the daemon's machine, the same path `fs.reveal` and the viewer take. */
    path: string;
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
 * A tab per open file, the way a preview tab works in an editor: the oldest unpinned one makes room
 * when the limit is reached. The tab that is open right now is never the one that goes, or opening
 * a file could close the file it just opened.
 */
export const openTab = (state: TabState, path: string, limit: number): TabState => {
    if (state.tabs.some((tab) => tab.path === path)) {
        return { tabs: state.tabs, active: path };
    }
    const tabs = [...state.tabs, { path, pinned: false, dirty: false }];
    while (tabs.length > Math.max(1, limit)) {
        const index = tabs.findIndex((tab) => !tab.pinned && tab.path !== path);
        if (index < 0) {
            break;
        }
        tabs.splice(index, 1);
    }
    return { tabs, active: path };
};

/* The neighbor takes over when the active tab closes: the one to its right, or the one before it. */
export const closeTab = (state: TabState, path: string): TabState => {
    const index = state.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) {
        return state;
    }
    const tabs = state.tabs.filter((tab) => tab.path !== path);
    if (state.active !== path) {
        return { tabs, active: state.active };
    }
    return { tabs, active: tabs[Math.min(index, tabs.length - 1)]?.path ?? null };
};

export const pinTab = (state: TabState, path: string, pinned: boolean): TabState => ({
    tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, pinned } : tab)),
    active: state.active
});

interface FilesStore extends TabState {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* The directories the tree has open, the way the tree names one: relative, POSIX, trailing slash. */
    expandedDirs: string[];
    load(projectId: string | null, state: TabState & { expandedDirs: string[] }): void;
    open(path: string, limit: number): void;
    close(path: string): void;
    setPinned(path: string, pinned: boolean): void;
    activate(path: string): void;
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
    open(path, limit) {
        set(openTab(get(), path, limit));
        useUi.getState().setPreviewOpen(true);
    },
    close(path) {
        const next = closeTab(get(), path);
        set(next);
        if (next.tabs.length === 0) {
            useUi.getState().setPreviewOpen(false);
        }
    },
    setPinned(path, pinned) {
        set(pinTab(get(), path, pinned));
    },
    activate(path) {
        set({ active: path });
    },
    setExpandedDirs(dirs) {
        set({ expandedDirs: dirs });
    }
}));
