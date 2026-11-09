import type { TableKind } from '@adecore/database/protocol';
import { isPathBelow, type FileLocation, type GitCompareMode, type GitDiffScope, type ProjectConsoleBinding, type ProjectFileTabView } from '@ruimte/contracts';
import { create } from 'zustand';
import { canDropAsTab, canSplit, cellAt, cellViewIds, locateView, viewIdsIn, type CellAt, type SplitZone } from '@/layout/split';
import { useDocument } from '@/state/document';
import { textDrafts } from '@/state/text-drafts';
import { useUi } from '@/state/ui';
import { closeAfterSaving } from '@/state/unsaved-close';
import { currentEndpointId } from './current-endpoint';

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

/* A version of an artifact in Output, read by its id from the machine; never a path. */
export interface ArtifactTab {
    /* `artifactTabKey`, so an artifact is open once. */
    key: string;
    kind: 'artifact';
    pinned: boolean;
    artifactId: string;
    /* Another machine of the account the artifact is kept on, by its daemon id; absent is the window's machine. */
    machineId?: string;
    /* The name the tab carries until the machine answered. */
    title: string;
}

/*
 * A comparison of two refs of one repository. It lives in this window's session only: it is never
 * stored, and the layout cell that holds it is left out of what the project remembers.
 */
export interface CompareTab {
    /* `compareTabKey`: one tab per repository and pair of refs, whatever the mode. */
    key: string;
    kind: 'compare';
    pinned: boolean;
    /* The repository, as the panel names it. */
    cwd: string;
    /* The refs as the person chose them. */
    from: string;
    to: string;
    mode: GitCompareMode;
    /* The commits the refs resolved to, kept so a mode switch reads the same snapshot until Refresh clears them. */
    resolved?: { fromCommit: string; toCommit: string };
    /* Goes up on every Refresh, so a reading that started earlier cannot pin its commits. */
    refresh: number;
}

/* One file of a commit, read-only and never read from the working tree. Session only, like the comparison it came from. */
export interface SnapshotTab {
    /* `snapshotTabKey`: the commit id and the path, so two reads of one branch at different moments are two tabs. */
    key: string;
    kind: 'snapshot';
    pinned: boolean;
    cwd: string;
    commit: string;
    /* The branch the person opened it from, for the tab to name. */
    branch: string;
    /* Relative to the repository root. */
    path: string;
}

export type SessionTab = CompareTab | SnapshotTab;

/* One loose view: a tab of a tab host that has no row in the sidebar. */
export type Tab = FileTab | DatabaseTab | ArtifactTab | SessionTab;

/* The content of the loose views, in the order they were opened. Where they stand is the layout's. */
export interface TabPool {
    tabs: Tab[];
}

/* A pool and the tab an operation on it leaves in front, which the caller puts on screen. */
export interface TabState extends TabPool {
    active: string | null;
}

export function isDatabaseTab(tab: Tab): tab is DatabaseTab {
    return 'kind' in tab && (tab.kind === 'table' || tab.kind === 'structure' || tab.kind === 'designer');
}

export function isArtifactTab(tab: Tab): tab is ArtifactTab {
    return 'kind' in tab && tab.kind === 'artifact';
}

export function isSessionTab(tab: Tab): tab is SessionTab {
    return 'kind' in tab && (tab.kind === 'compare' || tab.kind === 'snapshot');
}

export function isFileTab(tab: Tab): tab is FileTab {
    return !('kind' in tab);
}

export function compareTabKey(cwd: string, from: string, to: string): string {
    return `compare:${JSON.stringify([cwd, from, to])}`;
}

function snapshotTabKey(cwd: string, commit: string, path: string): string {
    return `snapshot:${JSON.stringify([cwd, commit, path])}`;
}

/* The comparison under a key, or undefined for another kind of tab. */
export function compareTabOf(state: TabPool, key: string | null): CompareTab | undefined {
    const tab = state.tabs.find((entry) => entry.key === key);
    return tab !== undefined && isSessionTab(tab) && tab.kind === 'compare' ? tab : undefined;
}

/* A comparison that is open already comes to the front with the mode asked for; otherwise a new one is placed. */
export function openCompareTab(state: TabPool, cwd: string, from: string, to: string, mode: GitCompareMode): TabState {
    const key = compareTabKey(cwd, from, to);
    const open = compareTabOf(state, key);

    if (open !== undefined) {
        return { tabs: state.tabs.map((tab) => (tab === open ? { ...open, mode } : tab)), active: key };
    }

    return placeTab(state, { key, kind: 'compare', pinned: false, cwd, from, to, mode, refresh: 0 });
}

/* A snapshot that is open already comes to the front. */
export function openSnapshotTab(state: TabPool, cwd: string, commit: string, branch: string, path: string): TabState {
    const key = snapshotTabKey(cwd, commit, path);

    if (state.tabs.some((tab) => tab.key === key)) {
        return { tabs: state.tabs, active: key };
    }

    return placeTab(state, { key, kind: 'snapshot', pinned: false, cwd, commit, branch, path });
}

const ARTIFACT_TAB_PREFIX = 'artifact:';

export function artifactTabKey(artifactId: string, machineId?: string): string {
    return machineId === undefined ? `${ARTIFACT_TAB_PREFIX}${artifactId}` : `${ARTIFACT_TAB_PREFIX}${machineId}/${artifactId}`;
}

/* The file tab under a key, or undefined for another kind of tab or a key that is not open. */
export function fileTabOf(state: TabPool, key: string | null): FileTab | undefined {
    const tab = state.tabs.find((entry) => entry.key === key);
    return tab === undefined || !isFileTab(tab) ? undefined : tab;
}

/* A tab that can become a row of the sidebar: a file and a table, not a diff, a commit, an artifact or the designer of a table that is not there yet. */
export function isPromotableTab(tab: Tab | undefined): boolean {
    if (tab === undefined || isArtifactTab(tab) || isSessionTab(tab)) {
        return false;
    }
    return isDatabaseTab(tab) ? tab.kind !== 'designer' : tab.view === undefined;
}

/* The artifact tab already open, or a new one at the end of the pool; either way in front. */
export function openArtifactTab(state: TabPool, artifactId: string, title: string, machineId?: string): TabState {
    const key = artifactTabKey(artifactId, machineId);
    if (state.tabs.some((tab) => tab.key === key)) {
        return { tabs: state.tabs, active: key };
    }
    return placeTab(state, { key, kind: 'artifact', pinned: false, artifactId, title, ...(machineId === undefined ? {} : { machineId }) });
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
 * The tabs of one host that close for the limit: the leftmost unpinned one makes room. `tabs` are the
 * host's loose tabs in strip order. Never the tab that just opened, nor one `keeps` holds on to, such
 * as a file with unsaved changes.
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
interface OpenedTab extends TabState {
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
        const reused = state.tabs.findIndex((tab) => isFileTab(tab) && tab.view !== undefined && !tab.pinned);
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
        if (!isFileTab(tab)) {
            return tab;
        }
        const path = tab.path === from ? to : isPathBelow(from, tab.path) ? `${to}${tab.path.slice(from.length)}` : null;
        if (path === null || tab.view?.commit !== undefined || isCheckoutDiff(tab.path, tab.view)) {
            return tab;
        }
        const key = tabKey(path, tab.view);
        renamed.set(tab.key, key);
        return { ...tab, path, key };
    });
    return { tabs, renamed };
}

export interface RevealLineRequest extends Omit<FileLocation, 'path'> {
    /* The tab this is about; a file that is not the one up ignores it. */
    key: string;
    /* One-based, the number the viewer puts in its gutter. */
    line: number;
    /* Goes up on every ask, so the same line twice is two jumps. */
    nonce: number;
}

interface RevealRequest {
    /* Absolute on the daemon's machine, the same path a tab carries. */
    path: string;
    /* Goes up on every ask, so revealing the same file twice is two reveals and not one. */
    nonce: number;
}

interface CaretRequest {
    /* The tab whose editor takes the keyboard; a file that is not the one up ignores it. */
    key: string;
    /* Goes up on every ask, so a file created twice under one name is two asks. */
    nonce: number;
}

interface CreateRequest {
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
    if (
        tab === undefined ||
        isArtifactTab(tab) ||
        isSessionTab(tab) ||
        (isFileTab(tab) && tab.view !== undefined) ||
        (isDatabaseTab(tab) && tab.table === undefined)
    ) {
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
interface FocusRequest {
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
    open(path: string, limit: number, view?: FileTabView, line?: number | Omit<FileLocation, 'path'>, options?: OpenOptions): void;
    /* The tab without moving the focus, for a caller that wants the file on the grid and the keyboard where it is. */
    openHidden(path: string, limit: number, view?: FileTabView, line?: number | Omit<FileLocation, 'path'>, options?: OpenOptions): void;
    /* Tabs a caller worked out itself, such as for a database view (`database/open.ts`), put on screen the way an open file is. */
    show(next: TabState, limit: number, options?: OpenOptions): void;
    /* The center joins the cell's tabs; an edge splits it. */
    dropTab(next: TabState, limit: number, at: CellAt, zone: SplitZone, index?: number | null): boolean;
    /* A file dragged to a cell's edge becomes a tab there, in a cell of its own. The key, or null when the grid has no room. */
    dropFile(path: string, limit: number, at: CellAt, zone: SplitZone): string | null;
    /* A change dragged to a cell: the middle joins its tabs, an edge makes a cell of its own. False when nothing landed. */
    dropDiff(path: string, view: FileTabView, limit: number, at: CellAt, zone: SplitZone, index?: number | null): boolean;
    /* What the limit leaves alone besides a pin: a file with unsaved changes and a table with edits nobody submitted. */
    keepsOpen(tab: Tab): boolean;
    /* A file or folder moved on the machine; its tabs go with it, and the cells that hold them. Answers what was renamed. */
    moved(from: string, to: string): Map<string, string>;
    /* A file with unsaved changes is saved first, and a table with edits nobody submitted asks first. A key that is no loose tab is a database view of the project, which only leaves its cell. */
    close(key: string): void;
    /* `close`, answering whether the tab is gone: false when a person kept it at one of those questions. */
    closeGuarded(key: string): Promise<boolean>;
    /* The tabs one after another, each through its own questions; stops at the first a person keeps. */
    closeInOrder(keys: readonly string[]): Promise<boolean>;
    /* Takes the tab out of the pool without remembering it, for a tab that goes on as something else. */
    release(key: string): void;
    /* The answer to that question. */
    confirmDiscard(): void;
    cancelDiscard(): void;
    setUnsubmitted(key: string, unsubmitted: boolean): void;
    setPinned(key: string, pinned: boolean): void;
    setCompareMode(key: string, mode: GitCompareMode): void;
    /* Keeps the commits a reading resolved, unless a Refresh came in since it started. */
    resolveComparison(key: string, refresh: number, resolved: NonNullable<CompareTab['resolved']>): void;
    /* Forgets the resolved commits, so the next reading resolves the refs again. */
    refreshComparison(key: string): void;
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
 * The files, diffs, commits and database views a person opened, with what the tree has unfolded.
 * Machine state in the project's local file (`project/panels-port.ts`), never in `project.json`. The
 * layout owns where they stand; the pool never holds a view the layout does not place.
 */
export const useFiles = create<FilesStore>((set, get) => {
    const hostTabs = (key: string): Tab[] => {
        const { layout } = useDocument.getState();
        const at = layout === null ? null : locateView(layout, key);
        const cell = layout === null || at === null ? null : cellAt(layout, at);
        return cell === null ? [] : cellViewIds(cell).flatMap((id) => get().tabs.find((entry) => entry.key === id) ?? []);
    };
    /* Who waits on the answer of a close that may ask a question first. */
    const waiting = new Map<string, ((closed: boolean) => void)[]>();
    const settle = (key: string, closed: boolean): void => {
        const resolvers = waiting.get(key);
        waiting.delete(key);
        resolvers?.forEach((resolve) => resolve(closed));
    };
    /* Leaves the pool and the cell that holds the tab, and goes where a closed tab goes. A view of the project only leaves its cell. */
    const closeNow = (key: string): void => {
        const { [key]: _dropped, ...unsubmitted } = get().unsubmitted;
        const tab = get().tabs.find((entry) => entry.key === key);
        set({
            ...closeTab(get(), key),
            unsubmitted,
            discarding: get().discarding === key ? null : get().discarding,
            recent: rememberClosed(get().recent, tab)
        });
        if (tab === undefined) {
            useDocument.getState().closeViewTab(key);
        } else {
            useDocument.getState().closeLoose(key);
        }
        settle(key, true);
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
    const take = (opened: OpenedTab, line: number | Omit<FileLocation, 'path'> | undefined, options: OpenOptions | undefined): void => {
        const key = opened.active!;
        const position = typeof line === 'number' ? { line } : line;
        const reveal = position?.line === undefined ? get().revealLine : { ...position, key, line: position.line, nonce: (get().revealLine?.nonce ?? 0) + 1 };
        set({ tabs: opened.tabs, focusRequest: focusRequestAfter(key, options), revealLine: reveal });
        if (opened.replaced !== undefined) {
            useDocument.getState().replaceViewKey(opened.replaced, key);
        }
    };
    const openIn = (
        opened: OpenedTab,
        limit: number,
        line: number | Omit<FileLocation, 'path'> | undefined,
        options: OpenOptions | undefined,
        quietly: boolean
    ): void => {
        const key = opened.active!;
        take(opened, line, options);
        useDocument.getState().showLoose(key, { focus: !quietly });
        makeRoom(key, limit);
    };
    /* A drop that did not land leaves a tab no cell holds, which goes again. */
    const settleDrop = (key: string, limit: number, landed: boolean): boolean => {
        if (!landed) {
            pruneLoose();
            return false;
        }
        makeRoom(key, limit);
        return true;
    };
    const dropLoose = (key: string, at: CellAt, zone: SplitZone, index: number | null): boolean =>
        zone === 'center' ? useDocument.getState().dropLooseAsTab(key, at, index) : useDocument.getState().dropLooseAt(key, at, zone);
    const patchFileView = (key: string, patch: Partial<FileTabView>): void => {
        set({ tabs: get().tabs.map((tab) => (isFileTab(tab) && tab.key === key && tab.view ? { ...tab, view: { ...tab.view, ...patch } } : tab)) });
    };

    const patchComparison = (key: string, change: (tab: CompareTab) => CompareTab): void => {
        set({ tabs: get().tabs.map((tab) => (isSessionTab(tab) && tab.kind === 'compare' && tab.key === key ? change(tab) : tab)) });
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
        dropTab(next, limit, at, zone, index = null) {
            const key = next.active;
            const { layout } = useDocument.getState();
            const cell = layout === null ? null : cellAt(layout, at);
            if (key !== null && zone === 'center' && cell !== null && cell.viewId === key && cellViewIds(cell).length === 1) {
                useDocument.getState().activateTab(key);
                return true;
            }
            if (key === null || layout === null || !(zone === 'center' ? canDropAsTab(layout, at, key) : canSplit(layout, at, zone, key))) {
                return false;
            }
            set({ tabs: next.tabs, focusRequest: focusRequestAfter(key, undefined) });
            return settleDrop(key, limit, dropLoose(key, at, zone, index));
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
            return settleDrop(key, limit, useDocument.getState().dropLooseAt(key, at, zone)) ? key : null;
        },
        dropDiff(path, view, limit, at, zone, index = null) {
            const key = tabKey(path, view);
            const { layout } = useDocument.getState();
            if (layout === null || (zone !== 'center' && !canSplit(layout, at, zone, key))) {
                return false;
            }
            take(openTab(get(), path, view), undefined, undefined);
            return settleDrop(key, limit, dropLoose(key, at, zone, index));
        },
        keepsOpen(tab) {
            return !isFileTab(tab) ? get().unsubmitted[tab.key] === true : tab.view === undefined && textDrafts.isUnsaved(currentEndpointId(), tab.path);
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
            if (get().unsubmitted[key] === true) {
                set({ discarding: key });
                return;
            }
            if (tab === undefined || !isFileTab(tab)) {
                closeNow(key);
                return;
            }
            closeAfterSaving(
                currentEndpointId(),
                tab.view !== undefined ? [] : [tab.path],
                () => closeNow(key),
                () => settle(key, false)
            );
        },
        closeGuarded(key) {
            if (get().tabs.every((entry) => entry.key !== key) && get().unsubmitted[key] !== true) {
                return Promise.resolve(true);
            }
            return new Promise((resolve) => {
                waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
                get().close(key);
            });
        },
        async closeInOrder(keys) {
            for (const key of keys) {
                if (!(await get().closeGuarded(key))) {
                    return false;
                }
            }
            return true;
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
            const key = get().discarding;
            set({ discarding: null });
            if (key !== null) {
                settle(key, false);
            }
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
        setCompareMode(key, mode) {
            patchComparison(key, (tab) => ({ ...tab, mode }));
        },
        resolveComparison(key, refresh, resolved) {
            patchComparison(key, (tab) => (tab.refresh === refresh ? { ...tab, resolved } : tab));
        },
        refreshComparison(key) {
            patchComparison(key, ({ resolved: _forgotten, ...tab }) => ({ ...tab, refresh: tab.refresh + 1 }));
        },
        setScope(key, scope) {
            patchFileView(key, { scope });
        },
        /* Staging a file from its own diff moves the tab to the side of the index it now sits on. */
        setStaged(key, staged) {
            patchFileView(key, { staged });
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
