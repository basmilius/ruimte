import type { TableKind } from '@adecore/database/protocol';
import type { GitDiffScope, ProjectConsoleBinding, ProjectFileTabView } from '@ruimte/contracts';
import { create } from 'zustand';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { textDrafts } from '@/state/text-drafts';
import { useUi } from '@/state/ui';

export type FileTabView = ProjectFileTabView;
export type ConsoleBinding = ProjectConsoleBinding;

/* A file, its diff or a whole commit. */
export interface FileTab {
    /* What names this tab among the others: the path, `diff:` and the path for a diff tab, or
       `commit:` and the hash for a whole commit. */
    key: string;
    /* Absolute on the daemon's machine, the same path `fs.reveal` and the viewer take. */
    path: string;
    /* Absent for the file itself; a diff of the same file is a tab of its own next to it. */
    view?: FileTabView;
    /* Where a `.sql` file runs, which draws its tab as a console. */
    console?: ConsoleBinding;
    /* A pinned tab survives the limit; double-click on a tab sets it. */
    pinned: boolean;
}

interface DatabaseTabBase {
    /* `database:` and an id of its own, since two tabs may show one table (`database/tabs.ts`). */
    key: string;
    pinned: boolean;
    connectionId: string;
    schema: string;
}

/* A view of a database: a table's rows, its structure, or the designer, which without a table makes a new one. */
export type DatabaseTab =
    | (DatabaseTabBase & { kind: 'table'; table: string; where?: string; tableKind?: TableKind })
    | (DatabaseTabBase & { kind: 'structure'; table: string; tableKind?: TableKind })
    | (DatabaseTabBase & { kind: 'designer'; table?: string });

/* One tab of the files cell. */
export type Tab = FileTab | DatabaseTab;

export interface TabState {
    tabs: Tab[];
    active: string | null;
}

export function isDatabaseTab(tab: Tab): tab is DatabaseTab {
    return 'kind' in tab;
}

/* The file tab under a key, or undefined for a database tab or a key that is not open. */
export function fileTabOf(state: TabState, key: string | null): FileTab | undefined {
    const tab = state.tabs.find((entry) => entry.key === key);
    return tab === undefined || isDatabaseTab(tab) ? undefined : tab;
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
 * A new tab at the end, the way a preview tab works in an editor: the oldest unpinned one makes room
 * when the limit is reached. The tab that opens is never the one that goes, or opening a file could
 * close the file it just opened, and neither is one `keeps` holds on to, such as a file with unsaved
 * changes or a table with edits nobody submitted.
 */
export function placeTab(state: TabState, tab: Tab, limit: number, keeps: (tab: Tab) => boolean = () => false): TabState {
    const tabs = [...state.tabs, tab];
    while (tabs.length > Math.max(1, limit)) {
        const index = tabs.findIndex((entry) => !entry.pinned && entry.key !== tab.key && !keeps(entry));
        if (index < 0) {
            break;
        }
        tabs.splice(index, 1);
    }
    return { tabs, active: tab.key };
}

/* A tab per open file, under the limit `placeTab` keeps. */
export function openTab(state: TabState, path: string, limit: number, view?: FileTabView, keeps: (tab: Tab) => boolean = () => false): TabState {
    const key = tabKey(path, view);
    const open = fileTabOf(state, key);
    if (open) {
        // A diff tab that is open again asks for another scope, so the tab follows, it is not opened twice.
        const tabs = view === undefined ? state.tabs : state.tabs.map((tab) => (tab === open ? { ...open, view } : tab));
        return { tabs, active: key };
    }
    if (view) {
        /* Changes share one tab, the way a review pane works: the next change opens in the diff tab
           nobody pinned, and only a pin makes a diff stay while another one is looked at. */
        const reused = state.tabs.findIndex((tab) => !isDatabaseTab(tab) && tab.view !== undefined && !tab.pinned);
        if (reused >= 0) {
            const tabs = [...state.tabs];
            tabs[reused] = { key, path, view, pinned: false };
            return { tabs, active: key };
        }
    }
    return placeTab(state, { key, path, ...(view ? { view } : {}), pinned: false }, limit, keeps);
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
        if (isDatabaseTab(tab)) {
            return tab;
        }
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

/* Where a `.sql` file runs, or none: it opens as the file itself. */
export function bindConsole(state: TabState, key: string, binding: ConsoleBinding | null): TabState {
    const tab = fileTabOf(state, key);
    if (tab === undefined) {
        return state;
    }
    const { console: _was, ...rest } = tab;
    const next: FileTab = binding === null ? rest : { ...rest, console: binding };
    return { tabs: state.tabs.map((entry) => (entry === tab ? next : entry)), active: state.active };
}

/* What the database said a tab's table is, which corrects what the tab was opened with. */
export function correctTableKind(state: TabState, key: string, tableKind: TableKind): TabState {
    const tab = state.tabs.find((entry) => entry.key === key);
    if (tab === undefined || !isDatabaseTab(tab) || tab.kind === 'designer' || tab.tableKind === tableKind) {
        return state;
    }
    return { tabs: state.tabs.map((entry) => (entry === tab ? { ...tab, tableKind } : entry)), active: state.active };
}

/* What the empty preview offers to open again: a file by its path, or a database view as it stood. */
export type ClosedTab = { kind: 'file'; path: string } | DatabaseTab;

/* How many closed tabs the empty preview offers to open again. */
export const RECENT_FILES_LIMIT = 5;

function sameTarget(left: ClosedTab, right: ClosedTab): boolean {
    if (left.kind === 'file' || right.kind === 'file') {
        return left.kind === 'file' && right.kind === 'file' && left.path === right.path;
    }
    return (
        left.kind === right.kind &&
        left.connectionId === right.connectionId &&
        left.schema === right.schema &&
        left.table === right.table &&
        (left.kind === 'table' ? left.where : undefined) === (right.kind === 'table' ? right.where : undefined)
    );
}

/*
 * A tab that closed goes on top of the tabs to open again. A diff or a commit is not a file to go back to, and
 * the designer of a table nobody made yet has nothing to go back to either.
 */
export function rememberClosed(recent: readonly ClosedTab[], tab: Tab | undefined): ClosedTab[] {
    if (tab === undefined || (!isDatabaseTab(tab) && tab.view !== undefined) || (isDatabaseTab(tab) && tab.table === undefined)) {
        return [...recent];
    }
    const closed: ClosedTab = isDatabaseTab(tab) ? { ...tab, pinned: false } : { kind: 'file', path: tab.path };
    return [closed, ...recent.filter((entry) => !sameTarget(entry, closed))].slice(0, RECENT_FILES_LIMIT);
}

export interface OpenOptions {
    /* False leaves the keyboard where it is; the files cell takes it otherwise. */
    focus?: boolean;
}

interface FilesStore extends TabState {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* Tabs of this project closed in this session, newest first. Not saved: the tabs that are open are what the project keeps. */
    recent: ClosedTab[];
    /* Counts the tabs opened by hand. The files cell watches it to take the keyboard, so the tab
       that just opened answers to ⌘W. Restoring a project does not count: nothing was asked for, and
       neither does a tree that opens its row, since the next arrow key belongs to the tree. */
    focusRequest: number;
    /* The database tabs whose table holds edits nobody submitted. Not saved: the edits are not either. */
    unsubmitted: Record<string, true>;
    /* A database tab a person asked to close while it holds such edits, which waits for their answer. */
    discarding: string | null;
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
    /* Tabs a caller worked out itself, such as for a database view (`database/open.ts`), put on screen the way an open file is. */
    show(next: TabState, options?: OpenOptions): void;
    /* What the limit leaves alone besides a pin: a file with unsaved changes and a table with edits nobody submitted. */
    keepsOpen(tab: Tab): boolean;
    /* A file or folder moved on the machine; its tabs go with it. */
    moved(from: string, to: string): void;
    /* A file with unsaved changes is saved first, and a table with edits nobody submitted asks first. */
    close(key: string): void;
    closeOthers(key: string): void;
    closeAll(): void;
    /* The answer to that question. */
    confirmDiscard(): void;
    cancelDiscard(): void;
    setUnsubmitted(key: string, unsubmitted: boolean): void;
    setPinned(key: string, pinned: boolean): void;
    setScope(key: string, scope: GitDiffScope): void;
    setStaged(key: string, staged: boolean): void;
    setConsole(key: string, binding: ConsoleBinding | null): void;
    setTableKind(key: string, tableKind: TableKind): void;
    revealInFiles(path: string): void;
    requestCreate(kind: CreateRequest['kind']): void;
    requestCaret(key: string): void;
    clearCaret(): void;
    activate(key: string): void;
    setExpandedDirs(dirs: string[]): void;
}

/*
 * Which files and database views the viewer has open and what the tree has unfolded. Machine state:
 * it travels with the project's local file on this machine (`project/panels-port.ts`), never in
 * `project.json`, so another person opening the same canvas gets none of it.
 */
export const useFiles = create<FilesStore>((set, get) => {
    /* The last close takes the cell away again, the way an open brought it. */
    const closeNow = (key: string): void => {
        const { [key]: _dropped, ...unsubmitted } = get().unsubmitted;
        const next = closeTab(get(), key);
        set({
            ...next,
            unsubmitted,
            discarding: get().discarding === key ? null : get().discarding,
            recent: rememberClosed(
                get().recent,
                get().tabs.find((entry) => entry.key === key)
            )
        });
        if (next.tabs.length === 0) {
            useDocument.getState().hideFiles();
        }
    };
    const focusRequestAfter = (options: OpenOptions | undefined): number => (options?.focus === false ? get().focusRequest : get().focusRequest + 1);

    return {
        projectId: null,
        recent: [],
        focusRequest: 0,
        unsubmitted: {},
        discarding: null,
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
                unsubmitted: {},
                discarding: null,
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
            set({ ...openTab(get(), path, limit, view, get().keepsOpen), focusRequest: focusRequestAfter(options), revealLine: reveal });
        },
        show(next, options) {
            set({ ...next, focusRequest: focusRequestAfter(options) });
            useDocument.getState().showFiles();
        },
        keepsOpen(tab) {
            return isDatabaseTab(tab) ? get().unsubmitted[tab.key] === true : tab.view === undefined && textDrafts.isUnsaved(currentEndpointId(), tab.path);
        },
        moved(from, to) {
            set(moveTabs(get(), from, to));
        },
        close(key) {
            const tab = get().tabs.find((entry) => entry.key === key);
            if (tab !== undefined && isDatabaseTab(tab)) {
                if (get().unsubmitted[key] === true) {
                    set({ discarding: key });
                } else {
                    closeNow(key);
                }
                return;
            }
            closeAfterSaving(currentEndpointId(), tab === undefined || tab.view !== undefined ? [] : [tab.path], () => closeNow(key));
        },
        /* A pinned tab goes with the rest, since the person asked for this one tab and nothing else. */
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
        confirmDiscard() {
            const key = get().discarding;
            if (key !== null) {
                closeNow(key);
            }
        },
        cancelDiscard() {
            set({ discarding: null });
        },
        setUnsubmitted(key, unsubmitted) {
            if ((get().unsubmitted[key] === true) === unsubmitted) {
                return;
            }
            const { [key]: _was, ...rest } = get().unsubmitted;
            set({ unsubmitted: unsubmitted ? { ...rest, [key]: true } : rest });
        },
        setPinned(key, pinned) {
            set(pinTab(get(), key, pinned));
        },
        setScope(key, scope) {
            set({ tabs: get().tabs.map((tab) => (!isDatabaseTab(tab) && tab.key === key && tab.view ? { ...tab, view: { ...tab.view, scope } } : tab)) });
        },
        /* Staging a file from its own diff moves the tab to the side of the index it now sits on. */
        setStaged(key, staged) {
            set({ tabs: get().tabs.map((tab) => (!isDatabaseTab(tab) && tab.key === key && tab.view ? { ...tab, view: { ...tab.view, staged } } : tab)) });
        },
        setConsole(key, binding) {
            set(bindConsole(get(), key, binding));
        },
        setTableKind(key, tableKind) {
            set(correctTableKind(get(), key, tableKind));
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
    };
});
