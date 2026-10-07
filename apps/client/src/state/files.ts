import type { TableKind } from '@adecore/database/protocol';
import type { GitDiffScope, ProjectConsoleBinding, ProjectFileTabView } from '@ruimte/contracts';
import { create } from 'zustand';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { canSplit, cellAt, cellViewIds, locateView, viewIdsIn, type CellAt, type SplitZone } from '@/shell/split';
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

/* One loose view: a tab of a tab host that has no row in the sidebar. */
export type Tab = FileTab | DatabaseTab;

/* The content of the loose views, in the order they were opened. Where they stand is the layout's. */
export interface TabPool {
    tabs: Tab[];
}

/* A pool and the tab an operation on it leaves in front, which the caller puts on screen. */
export interface TabState extends TabPool {
    active: string | null;
}

export function isDatabaseTab(tab: Tab): tab is DatabaseTab {
    return 'kind' in tab;
}

/* The file tab under a key, or undefined for a database tab or a key that is not open. */
export function fileTabOf(state: TabPool, key: string | null): FileTab | undefined {
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

/* A new tab at the end of the pool. Where it stands and how many may stand there is the host's (`tabsOverLimit`). */
export function placeTab(state: TabPool, tab: Tab): TabState {
    return { tabs: [...state.tabs, tab], active: tab.key };
}

/*
 * The tabs of one host that have to close for the limit, the way a preview tab works in an editor:
 * the leftmost unpinned one makes room. `tabs` are the loose tabs of the host in strip order. The tab
 * that opened is never the one that goes, or opening a file could close the file it just opened, and
 * neither is one `keeps` holds on to, such as a file with unsaved changes or a table with edits nobody
 * submitted.
 */
export function tabsOverLimit(tabs: readonly Tab[], limit: number, opened: string, keeps: (tab: Tab) => boolean = () => false): string[] {
    const remaining = [...tabs];
    const closing: string[] = [];
    while (remaining.length > Math.max(1, limit)) {
        const index = remaining.findIndex((entry) => !entry.pinned && entry.key !== opened && !keeps(entry));
        if (index < 0) {
            break;
        }
        closing.push(remaining[index]!.key);
        remaining.splice(index, 1);
    }
    return closing;
}

/* What opening a path did to the pool; `replaced` is the key of the diff tab it took over, which the layout has to rename. */
export interface OpenedTab extends TabState {
    replaced?: string;
}

/* A tab per open file; one that is open already is the one that comes to the front. */
export function openTab(state: TabPool, path: string, view?: FileTabView): OpenedTab {
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
            const was = tabs[reused]!.key;
            tabs[reused] = { key, path, view, pinned: false };
            return { tabs, active: key, replaced: was };
        }
    }
    return placeTab(state, { key, path, ...(view ? { view } : {}), pinned: false });
}

export function closeTab(state: TabPool, key: string): TabPool {
    return { tabs: state.tabs.filter((tab) => tab.key !== key) };
}

export function pinTab(state: TabPool, key: string, pinned: boolean): TabPool {
    return { tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, pinned } : tab)) };
}

/* The tabs of a file or folder that moved follow it, a diff of the file too since its key names the path. A commit or a whole checkout is no file. */
export function moveTabs(state: TabPool, from: string, to: string): TabPool & { renamed: Map<string, string> } {
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
    return { tabs, renamed };
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
export function bindConsole(state: TabPool, key: string, binding: ConsoleBinding | null): TabPool {
    const tab = fileTabOf(state, key);
    if (tab === undefined) {
        return state;
    }
    const { console: _was, ...rest } = tab;
    const next: FileTab = binding === null ? rest : { ...rest, console: binding };
    return { tabs: state.tabs.map((entry) => (entry === tab ? next : entry)) };
}

/* What the database said a tab's table is, which corrects what the tab was opened with. */
export function correctTableKind(state: TabPool, key: string, tableKind: TableKind): TabPool {
    const tab = state.tabs.find((entry) => entry.key === key);
    if (tab === undefined || !isDatabaseTab(tab) || tab.kind === 'designer' || tab.tableKind === tableKind) {
        return state;
    }
    return { tabs: state.tabs.map((entry) => (entry === tab ? { ...tab, tableKind } : entry)) };
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
    /* False leaves the keyboard where it is; the cell that shows the tab takes it otherwise. */
    focus?: boolean;
}

/* The tab whose body is asked to take the keyboard; `nonce` goes up on every ask, so the same tab twice is two asks. */
export interface FocusRequest {
    key: string;
    nonce: number;
}

interface FilesStore extends TabPool {
    /* Whose tabs these are; a canvas that is not open has none. */
    projectId: string | null;
    /* Tabs of this project closed in this session, newest first. Not saved: the tabs that are open are what the project keeps. */
    recent: ClosedTab[];
    /* Set by the tabs opened by hand. The body that shows the tab watches it to take the keyboard, so the tab
       that just opened answers to ⌘W. Restoring a project does not count: nothing was asked for, and
       neither does a tree that opens its row, since the next arrow key belongs to the tree. */
    focusRequest: FocusRequest | null;
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
    /* The pool of a project that opens; a tab the layout does not stand anywhere has no view to be and is left out. */
    load(projectId: string | null, state: { tabs: Tab[]; expandedDirs: string[] }): void;
    /* A tab in the host the last focused one leads to, brought to the front with the keyboard in it. The limit is that host's. */
    open(path: string, limit: number, view?: FileTabView, line?: number, options?: OpenOptions): void;
    /* The tab without moving the focus, for a caller that wants the file on the grid and the keyboard where it is. */
    openHidden(path: string, limit: number, view?: FileTabView, line?: number, options?: OpenOptions): void;
    /* Tabs a caller worked out itself, such as for a database view (`database/open.ts`), put on screen the way an open file is. */
    show(next: TabState, limit: number, options?: OpenOptions): void;
    /* A file dragged to a cell's edge becomes a tab there, in a cell of its own. The key, or null when the grid has no room. */
    dropFile(path: string, limit: number, at: CellAt, zone: SplitZone): string | null;
    /* A change dragged to a cell: the middle joins its tabs, an edge makes a cell of its own. False when nothing landed. */
    dropDiff(path: string, view: FileTabView, limit: number, at: CellAt, zone: SplitZone): boolean;
    /* What the limit leaves alone besides a pin: a file with unsaved changes and a table with edits nobody submitted. */
    keepsOpen(tab: Tab): boolean;
    /* A file or folder moved on the machine; its tabs go with it, and the cells that hold them. Answers what was renamed. */
    moved(from: string, to: string): Map<string, string>;
    /* A file with unsaved changes is saved first, and a table with edits nobody submitted asks first. */
    close(key: string): void;
    /* The other loose tabs of the host the tab stands in; a pinned tab goes too, and a project view stays. */
    closeOthers(key: string): void;
    /* Every loose tab of the host the tab stands in. */
    closeAll(key: string): void;
    /* Takes the tab out of the pool without remembering it, for a tab that goes on as something else. */
    release(key: string): void;
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
    setExpandedDirs(dirs: string[]): void;
}

/*
 * What the loose views are: the files, diffs, commits and database views a person opened, with what
 * the tree has unfolded. Machine state: it travels with the project's local file on this machine
 * (`project/panels-port.ts`), never in `project.json`, so another person opening the same canvas gets
 * none of it. The layout owns where they stand and which one is in front; a loose view that leaves
 * the layout leaves the pool, and the pool never holds one the layout does not place.
 */
export const useFiles = create<FilesStore>((set, get) => {
    const hostTabs = (key: string): Tab[] => {
        const { layout } = useDocument.getState();
        const at = layout === null ? null : locateView(layout, key);
        const cell = layout === null || at === null ? null : cellAt(layout, at);
        return cell === null ? [] : cellViewIds(cell).flatMap((id) => get().tabs.find((entry) => entry.key === id) ?? []);
    };
    /* Leaves the pool and the cell that holds the tab, and goes where a closed tab goes. */
    const closeNow = (key: string): void => {
        const { [key]: _dropped, ...unsubmitted } = get().unsubmitted;
        const tab = get().tabs.find((entry) => entry.key === key);
        set({
            ...closeTab(get(), key),
            unsubmitted,
            discarding: get().discarding === key ? null : get().discarding,
            recent: rememberClosed(get().recent, tab)
        });
        useDocument.getState().closeLoose(key);
    };
    /* The host the tab stands in is over its limit once a tab arrives, and its leftmost tab nobody holds on to makes room. */
    const makeRoom = (key: string, limit: number): void => {
        for (const closing of tabsOverLimit(hostTabs(key), limit, key, get().keepsOpen)) {
            closeNow(closing);
        }
    };
    const focusRequestAfter = (key: string, options: OpenOptions | undefined): FocusRequest | null =>
        options?.focus === false ? get().focusRequest : { key, nonce: (get().focusRequest?.nonce ?? 0) + 1 };
    /* The pool as an open left it, and the cell that followed a diff tab taking over another's key. */
    const take = (opened: OpenedTab, line: number | undefined, options: OpenOptions | undefined): void => {
        const key = opened.active!;
        const reveal = line === undefined ? get().revealLine : { key, line, nonce: (get().revealLine?.nonce ?? 0) + 1 };
        set({ tabs: opened.tabs, focusRequest: focusRequestAfter(key, options), revealLine: reveal });
        if (opened.replaced !== undefined) {
            useDocument.getState().replaceViewKey(opened.replaced, key);
        }
    };
    const openIn = (opened: OpenedTab, limit: number, line: number | undefined, options: OpenOptions | undefined, quietly: boolean): void => {
        const key = opened.active!;
        take(opened, line, options);
        useDocument.getState().showLoose(key, { focus: !quietly });
        makeRoom(key, limit);
    };

    return {
        projectId: null,
        recent: [],
        focusRequest: null,
        unsubmitted: {},
        discarding: null,
        tabs: [],
        expandedDirs: [],
        reveal: null,
        revealLine: null,
        caret: null,
        createRequest: null,
        load(projectId, state) {
            const { layout } = useDocument.getState();
            const placed = new Set(layout === null ? [] : viewIdsIn(layout));
            set({
                projectId,
                tabs: state.tabs.filter((tab) => placed.has(tab.key)),
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
           tab in the host they were working in, like any view. Beside it is a drag. */
        open(path, limit, view, line, options) {
            openIn(openTab(get(), path, view), limit, line, options, false);
        },
        openHidden(path, limit, view, line, options) {
            openIn(openTab(get(), path, view), limit, line, options, true);
        },
        show(next, limit, options) {
            const key = next.active;
            set({ tabs: next.tabs, focusRequest: key === null ? get().focusRequest : focusRequestAfter(key, options) });
            if (key !== null) {
                useDocument.getState().showLoose(key, { focus: true });
                makeRoom(key, limit);
            }
        },
        dropFile(path, limit, at, zone) {
            const key = tabKey(path);
            const { layout } = useDocument.getState();
            if (layout === null || !canSplit(layout, at, zone, key)) {
                return null;
            }
            if (fileTabOf(get(), key) === undefined) {
                set(placeTab(get(), { key, path, pinned: false }));
            }
            if (!useDocument.getState().dropLooseAt(key, at, zone)) {
                pruneLoose();
                return null;
            }
            makeRoom(key, limit);
            return key;
        },
        dropDiff(path, view, limit, at, zone) {
            const key = tabKey(path, view);
            const { layout } = useDocument.getState();
            if (layout === null || (zone !== 'center' && !canSplit(layout, at, zone, key))) {
                return false;
            }
            take(openTab(get(), path, view), undefined, undefined);
            const landed = zone === 'center' ? useDocument.getState().dropLooseAsTab(key, at) : useDocument.getState().dropLooseAt(key, at, zone);
            if (!landed) {
                pruneLoose();
                return false;
            }
            makeRoom(key, limit);
            return true;
        },
        keepsOpen(tab) {
            return isDatabaseTab(tab) ? get().unsubmitted[tab.key] === true : tab.view === undefined && textDrafts.isUnsaved(currentEndpointId(), tab.path);
        },
        moved(from, to) {
            const { renamed, ...next } = moveTabs(get(), from, to);
            set(next);
            for (const [was, key] of renamed) {
                useDocument.getState().replaceViewKey(was, key);
            }
            return renamed;
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
            for (const tab of hostTabs(key)) {
                if (tab.key !== key) {
                    get().close(tab.key);
                }
            }
        },
        closeAll(key) {
            for (const tab of hostTabs(key)) {
                get().close(tab.key);
            }
        },
        release(key) {
            const { [key]: _dropped, ...unsubmitted } = get().unsubmitted;
            set({ ...closeTab(get(), key), unsubmitted });
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
           the tab onto the grid. */
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
        setExpandedDirs(dirs) {
            set({ expandedDirs: dirs });
        }
    };
});

/*
 * A loose view that left the layout is closed: a cell that closed, a view that took its place, a
 * project that went. It goes where a closed tab goes, so what was in it can be opened again.
 */
function pruneLoose(): void {
    const { layout } = useDocument.getState();
    const placed = new Set(layout === null ? [] : viewIdsIn(layout));
    const { tabs, unsubmitted, recent } = useFiles.getState();
    const gone = tabs.filter((tab) => !placed.has(tab.key));
    if (gone.length === 0) {
        return;
    }
    const rest = Object.fromEntries(Object.entries(unsubmitted).filter(([key]) => placed.has(key)));
    useFiles.setState({
        tabs: tabs.filter((tab) => placed.has(tab.key)),
        unsubmitted: rest as Record<string, true>,
        recent: gone.reduceRight((list, tab) => rememberClosed(list, tab), recent)
    });
}

// A project that loads is no close: its pool comes with it (`load`), and the stale one goes there.
useDocument.subscribe((state, previous) => {
    if (state.layout !== previous.layout && !state.loading) {
        pruneLoose();
    }
});
