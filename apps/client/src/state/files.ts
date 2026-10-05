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
export function isCheckoutDiff(path: string, view: FileTabView | undefined): boolean {
    return view !== undefined && view.commit === undefined && view.scope === 'base' && path === view.cwd;
}

/*
 * A file and its diff are two tabs of one path, so the view is part of what names them apart. A
 * commit is named after the commit and not after the path, because two commits of one repository
 * would otherwise be one tab.
 */
export function tabKey(path: string, view?: FileTabView): string {
    if (view?.commit !== undefined) {
        return `commit:${view.commit}`;
    }
    if (isCheckoutDiff(path, view)) {
        return `checkout:${path}`;
    }
    return view ? `diff:${path}` : path;
}

/*
 * A tab per open file, the way a preview tab works in an editor: the oldest unpinned one makes room
 * when the limit is reached. The tab that is open right now is never the one that goes, or opening
 * a file could close the file it just opened, and neither is one `keeps` holds on to, such as a file
 * with unsaved changes.
 */
export function openTab(state: TabState, path: string, limit: number, view?: FileTabView, keeps: (tab: FileTab) => boolean = () => false): TabState {
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
}

/* The neighbor takes over when the active tab closes: the one to its right, or the one before it. */
export function closeTab(state: TabState, key: string): TabState {
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) {
        return state;
    }
    const tabs = state.tabs.filter((tab) => tab.key !== key);
    if (state.active !== key) {
        return { tabs, active: state.active };
    }
    return { tabs, active: tabs[Math.min(index, tabs.length - 1)]?.key ?? null };
}

export function pinTab(state: TabState, key: string, pinned: boolean): TabState {
    return {
        tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, pinned } : tab)),
        active: state.active
    };
}

/* The tabs of a file or folder that moved follow it, a diff of the file too since its key names the path. A commit or a whole checkout is no file. */
export function moveTabs(state: TabState, from: string, to: string): TabState {
    const renamed = new Map<string, string>();
    const tabs = state.tabs.map((tab) => {
        const path = tab.path === from ? to : tab.path.startsWith(`${from}/`) ? `${to}${tab.path.slice(from.length)}` : null;
        if (path === null || tab.view?.commit !== undefined || isCheckoutDiff(tab.path, tab.view)) {
            return tab;
        }
        const key = tabKey(path, tab.view);
        renamed.set(tab.key, key);
        return { ...tab, path, key };
    });
    return { tabs, active: (state.active !== null ? renamed.get(state.active) : undefined) ?? state.active };
}

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

export interface CaretRequest {
    /* The tab whose editor takes the keyboard; a file that is not the one up ignores it. */
    key: string;
    /* Goes up on every ask, so a file created twice under one name is two asks. */
    nonce: number;
}

export interface CreateRequest {
    kind: 'file' | 'directory';
    /* Goes up on every ask, so asking for the same kind twice is two asks. */
    nonce: number;
}

/* How many closed files the empty preview offers to open again. */
export const RECENT_FILES_LIMIT = 5;

/* A file tab that closed goes on top of the files to open again; a diff or a commit is not a file to go back to. */
export function rememberClosed(recent: readonly string[], tab: FileTab | undefined): string[] {
    return tab === undefined || tab.view !== undefined ? [...recent] : [tab.path, ...recent.filter((path) => path !== tab.path)].slice(0, RECENT_FILES_LIMIT);
}

export interface OpenOptions {
    /* False leaves the keyboard where it is; the files cell takes it otherwise. */
    focus?: boolean;
}

interface FilesStore extends TabState {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* Files of this project closed in this session, newest first. Not saved: the tabs that are open are what the project keeps. */
    recent: string[];
    /* Counts the files opened by hand. The files cell watches it to take the keyboard, so the tab
       that just opened answers to ⌘W. Restoring a project does not count: nothing was asked for, and
       neither does a tree that opens its row, since the next arrow key belongs to the tree. */
    focusRequest: number;
    /* The directories the tree has open, the way the tree names one: relative, POSIX, trailing slash. */
    expandedDirs: string[];
    /* What the files panel was asked to bring into view, from a menu somewhere else in the app. */
    reveal: RevealRequest | null;
    /* The line the viewer was asked to jump to, from a file reference that named one. */
    revealLine: RevealLineRequest | null;
    /* A new file's editor, asked to take the keyboard once it is there; the editor clears it. */
    caret: CaretRequest | null;
    /* A new file or folder asked of the files panel from a menu or the palette, which names it inline. */
    createRequest: CreateRequest | null;
    load(projectId: string | null, state: TabState & { expandedDirs: string[] }): void;
    open(path: string, limit: number, view?: FileTabView, line?: number, options?: OpenOptions): void;
    /* The tab without the cell, for a caller that puts the files on the grid itself, such as a drop. */
    openHidden(path: string, limit: number, view?: FileTabView, line?: number, options?: OpenOptions): void;
    /* A file or folder moved on the machine; its tabs go with it. */
    moved(from: string, to: string): void;
    close(key: string): void;
    closeOthers(key: string): void;
    closeAll(): void;
    setPinned(key: string, pinned: boolean): void;
    setScope(key: string, scope: GitDiffScope): void;
    setStaged(key: string, staged: boolean): void;
    revealInFiles(path: string): void;
    requestCreate(kind: CreateRequest['kind']): void;
    requestCaret(key: string): void;
    clearCaret(): void;
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
    caret: null,
    createRequest: null,
    load(projectId, state) {
        set({
            projectId,
            tabs: state.tabs,
            active: state.active,
            expandedDirs: state.expandedDirs,
            reveal: null,
            revealLine: null,
            caret: null,
            createRequest: null,
            recent: []
        });
    },
    /* A tab and the cell that draws it are one thing to the person opening a file: an open puts the
       files in the cell they were working in, like any view, and the last close takes the cell away
       again. Beside it is a drag. */
    open(path, limit, view, line, options) {
        get().openHidden(path, limit, view, line, options);
        useDocument.getState().showFiles();
    },
    openHidden(path, limit, view, line, options) {
        const reveal = line === undefined ? get().revealLine : { key: tabKey(path, view), line, nonce: (get().revealLine?.nonce ?? 0) + 1 };
        const endpointId = currentEndpointId();
        const unsaved = (tab: FileTab): boolean => tab.view === undefined && textDrafts.isUnsaved(endpointId, tab.path);
        const focusRequest = options?.focus === false ? get().focusRequest : get().focusRequest + 1;
        set({ ...openTab(get(), path, limit, view, unsaved), focusRequest, revealLine: reveal });
    },
    moved(from, to) {
        set(moveTabs(get(), from, to));
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
    /* The files panel comes up if it was closed, and names the entry in the folder that is selected there. */
    requestCreate(kind) {
        useUi.getState().setPanel({ open: true, kind: 'files' });
        set({ createRequest: { kind, nonce: (get().createRequest?.nonce ?? 0) + 1 } });
    },
    requestCaret(key) {
        set({ caret: { key, nonce: (get().caret?.nonce ?? 0) + 1 } });
    },
    clearCaret() {
        set({ caret: null });
    },
    activate(key) {
        set({ active: key });
    },
    setExpandedDirs(dirs) {
        set({ expandedDirs: dirs });
    }
}));
