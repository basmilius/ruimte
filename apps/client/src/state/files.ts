import { create } from 'zustand';

const STORAGE_PREFIX = 'ruimte.files.tabs.';

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

const read = (projectId: string): TabState => {
    try {
        const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
        const stored = raw ? (JSON.parse(raw) as Partial<TabState>) : null;
        const tabs = (stored?.tabs ?? []).filter((tab): tab is FileTab => typeof tab?.path === 'string');
        const active = tabs.some((tab) => tab.path === stored?.active) ? (stored?.active ?? null) : (tabs[0]?.path ?? null);
        return { tabs, active };
    } catch {
        return { tabs: [], active: null };
    }
};

const persist = (projectId: string | null, state: TabState): void => {
    if (!projectId) {
        return;
    }
    try {
        sessionStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(state));
    } catch {
        // Storage that refuses keeps the tabs for this view only.
    }
};

interface FilesStore extends TabState {
    /* Whose tabs these are; a project that was never opened this session starts empty. */
    projectId: string | null;
    /* The panel width from before the viewer pushed it wider, so the last close gives it back. */
    panelWidthBefore: number | null;
    load(projectId: string | null): void;
    open(path: string, limit: number): void;
    close(path: string): void;
    setPinned(path: string, pinned: boolean): void;
    activate(path: string): void;
    rememberPanelWidth(width: number): void;
    forgetPanelWidth(): void;
}

/*
 * Which files the viewer has open. Machine state: it lives in `sessionStorage` per project, never in
 * `project.json`, so a reload keeps the tabs and another person opening the same canvas gets none.
 */
export const useFiles = create<FilesStore>((set, get) => ({
    projectId: null,
    tabs: [],
    active: null,
    panelWidthBefore: null,
    load(projectId) {
        if (get().projectId === projectId) {
            return;
        }
        set({ projectId, panelWidthBefore: null, ...(projectId ? read(projectId) : { tabs: [], active: null }) });
    },
    open(path, limit) {
        const next = openTab(get(), path, limit);
        persist(get().projectId, next);
        set(next);
    },
    close(path) {
        const next = closeTab(get(), path);
        persist(get().projectId, next);
        set(next);
    },
    setPinned(path, pinned) {
        const next = pinTab(get(), path, pinned);
        persist(get().projectId, next);
        set(next);
    },
    activate(path) {
        const next: TabState = { tabs: get().tabs, active: path };
        persist(get().projectId, next);
        set({ active: path });
    },
    rememberPanelWidth(width) {
        set({ panelWidthBefore: width });
    },
    forgetPanelWidth() {
        set({ panelWidthBefore: null });
    }
}));
