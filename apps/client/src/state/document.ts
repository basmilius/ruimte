import { useContext } from 'react';
import { createStore, type StoreApi } from 'zustand';
import {
    isCanvasView,
    isDesignView,
    nodeChats,
    viewChats,
    type NodeAccent,
    type NodeTitleSource,
    type ProjectDatabaseTarget,
    type ProjectDocument,
    type ProjectAccounts,
    type ProjectFlags,
    type ProjectIconChoice,
    type ProjectLocal,
    type ProjectNode,
    type ProjectView,
    type ProjectViewLocal,
    type SplitLayout,
    type StandaloneNode,
    type DesignChat
} from '@ruimte/contracts';
import type { LooseStrip } from '@/shell/legacy-files-cell';
import type { CanvasPatch } from '@/project/merge';
import type { CellAt, ShownView, SplitDirection, SplitZone } from '@/shell/split';
import { defaultCanvases } from '@/state/canvas';
import { defaultDiagrams } from '@/state/diagram';
import { defaultDrawings } from '@/state/drawing';
import { createDocumentContentSlice } from '@/state/document-content-slice';
import { createDocumentGridSlice } from '@/state/document-grid-slice';
import { cellViewOf, createDocumentKit, type DocumentPeers, type StandaloneRequest, type TrashedView, type ViewNotice } from '@/state/document-model';
import { createDocumentNodesSlice } from '@/state/document-nodes-slice';
import { createDocumentNoticeSlice } from '@/state/document-notice-slice';
import { createDocumentTabsSlice } from '@/state/document-tabs-slice';
import { createDocumentViewsSlice } from '@/state/document-views-slice';
import { CellViewContext, storeHook } from '@/state/workspace-stores';

export { canStandInCell, cellViewOf, type DocumentPeers, type StandaloneRequest, type TrashedView, type ViewNotice } from '@/state/document-model';

export interface DocumentState {
    /* In sidebar order. The active canvas view is stale here, since the canvas store is the editor of that one. */
    views: ProjectView[];
    /* The view of the focused cell, derived from the layout and kept beside it since everything outside the grid asks for it. */
    activeViewId: string | null;
    /* How the views stand beside each other on this machine. Null while no view is open at all. */
    layout: SplitLayout | null;
    /* A deliberate empty screen must not trigger the Chats project's automatic first chat. */
    emptyLayout: boolean;
    /* The view filling the whole grid for a while, the layout under it untouched. Never saved, and
       any move of the grid ends it, so the grid a person gets back is the one they left. */
    maximized: string | null;
    /* The canvas that was up last, which is where a node put back on a canvas lands. */
    lastCanvasViewId: string | null;
    /* A view in the tab host that last had the focus, which is where a loose view goes when the focus is elsewhere. */
    lastHostViewId: string | null;
    /* Machine state beside the document, never in the shared file: where every view stood. */
    viewLocal: Record<string, ProjectViewLocal>;
    /* Whether the keyboard is inside the body of a standalone view; Escape leaves it to the sidebar. */
    bodyFocused: boolean;
    /* What an agent's `view open` left on the banner over the views, in either setting. Null when there is
       nothing to say; one at a time, since the last thing an agent asked for is the one worth acting on. */
    viewNotice: ViewNotice | null;
    /* Counts changes to the document itself. Switching views writes the canvas back, which is not one. */
    edits: number;
    /* True for the one update that swaps in another project, so nobody reads it as edits. */
    loading: boolean;
    /* True while another writer's change is taken in: a node it drops is gone from the file, not closed here. */
    merging: boolean;
    /* True while the project on screen is read again whole from disk, which drops a node the same way a merge does. */
    reloading: boolean;
    /* The views that live in the shared file, which is the one a team commits. Everything else is
       this person's, which is what a view is until someone shares it. */
    shared: string[];
    /* This person's flags on views and nodes, by id. Only ever in the private file, like `shared` beside the views. */
    flags: ProjectFlags;
    /* This person's accounts per agent kind for the project's new starts, as the private file has them; only `project.setAccounts` changes them. */
    accounts: ProjectAccounts;
    /*
     * Views a person deleted that can still come back, oldest first. They are gone from the list and
     * the grid but not from the file, since another client and the daemon end what a view holds the
     * moment it leaves the file. Their sessions run on until `purgeTrash`.
     */
    trashed: TrashedView[];

    /* `loose` is what the project's panels hold of loose views (`state/panel-state.ts`), which the layout may stand in cells. */
    load(document: ProjectDocument | null, local: ProjectLocal | null, loose?: LooseStrip): void;
    /* `load` for the project already on screen, as the file now has it. The loose views on screen stay. */
    reload(document: ProjectDocument, local: ProjectLocal | null): void;
    /*
     * What another writer changed, taken in beside what this machine is editing: the merged list of
     * views, and what each canvas on screen has to take in. Not an edit, since it is already on disk,
     * and no view opens by itself: a person's grid only moves when the person moves it.
     */
    applyMerge(views: ProjectView[], canvases: Record<string, CanvasPatch>, shared: string[], flags: ProjectFlags): void;
    /* The accounts as the private file now has them; not an edit, since only the machine writes them. */
    takeAccounts(accounts: ProjectAccounts): void;
    /* Puts a view in the shared file or takes it back out. Only a person does this; see `SharedViewIdsSchema`. */
    setShared(id: string, shared: boolean): void;
    /* Flags views and nodes in one color, or takes their flags off with null. */
    setFlags(ids: readonly string[], color: NodeAccent | null): void;
    /* The nodes a gesture holds in any canvas on screen, which a merge leaves under the person's hand. */
    heldNodeIds(): Set<string>;
    /* Puts a view in the cell that has the focus, or moves the focus to the cell it already stands in. */
    setActiveView(id: string): void;
    /* The same, for a view someone else asked for: it answers what moved, so a toast can put it back.
       Null when nothing moved, which is a view this document does not have or the one already in front. */
    showView(id: string, options?: { newTab?: boolean }): ShownView | null;
    /* The way back out of that toast, run against the grid as it stands when the button is pressed. */
    undoShowView(shown: Omit<ShownView, 'layout'>): void;
    /* What an agent's `view open` has to say, put in the banner over whatever was standing in it. */
    showNotice(notice: ViewNotice): void;
    /* The button on that banner, whichever of the two it is. It takes the banner off the screen as
       well, which is what a card with a button has to do: leaving it up after the press reads as a
       press that did nothing. */
    runNotice(): void;
    dismissNotice(): void;
    /* A view into a cell's zone: the four edges split, the middle takes the place of what is there. */
    dropViewAt(viewId: string, at: CellAt, zone: SplitZone): void;
    /*
     * A loose view, whose content `state/files.ts` holds, put on screen: a tab in the focused host or in the
     * one that last had the focus, else a host of its own in the focused cell. `focus: false` leaves the
     * focus where it is unless the view took a cell's place. Null when nothing moved.
     */
    showLoose(key: string, options?: { focus?: boolean }): ShownView | null;
    /* A loose view lands in a cell's zone, standing nowhere yet or moving from where it stands. False when the grid has no room. */
    dropLooseAt(key: string, at: CellAt, zone: SplitZone): boolean;
    /* A loose view joins the tabs of a cell, which becomes a host. False when it already fills that cell alone. */
    dropLooseAsTab(key: string, at: CellAt, index?: number | null): boolean;
    /* Any view that can stand in a cell joins the tabs of one: from the sidebar, from another cell or within its own strip. `index` null goes right of the active tab. */
    dropViewAsTab(viewId: string, at: CellAt, index: number | null): boolean;
    /* The tab moves along the strip of its host, stopping at the ends. */
    moveTab(viewId: string, delta: number): void;
    /* The tab leaves its host for a cell of its own to the right. False when it is the only tab or the grid has no room. */
    splitTabOff(viewId: string): boolean;
    /* A host with a single tab becomes a plain cell again. */
    ungroupCell(at: CellAt): void;
    closeLoose(key: string): void;
    /* Closing a tab leaves the view available in the sidebar. */
    closeViewTab(viewId: string): void;
    /* A loose view that got another key (a file that moved) keeps its place wherever it stands. */
    replaceViewKey(from: string, to: string): void;
    /* The view becomes the active tab of its cell and the cell takes the focus. */
    activateTab(viewId: string): void;
    /* The focused host steps along its tabs, round the ends. */
    stepTab(delta: 1 | -1): void;
    /* A whole cell, tabs and all, lands in the zone of another: what dragging a bar does. */
    moveCellTo(from: CellAt, at: CellAt, zone: SplitZone): void;
    /* Splits the focused cell and puts a view in the new one. */
    splitFocused(direction: SplitDirection, viewId: string): void;
    closeCellAt(at: CellAt): void;
    /* Every cell but this one; the views stay in the project, as with closing one. */
    closeOtherCells(at: CellAt): void;
    /* The cells in the columns right of this one. */
    closeCellsRightOf(at: CellAt): void;
    focusCellAt(at: CellAt): void;
    /* Fills the grid with the focused cell, or puts the grid back as it was. */
    toggleMaximized(): void;
    /* The focus one cell along, which is how a grid is navigated: by direction, never by number. */
    focusTowards(direction: SplitDirection): void;
    /* A splitter dragged between columns or cells: every share on that axis, in order. */
    resizeColumns(sizes: readonly number[]): void;
    resizeCells(column: number, sizes: readonly number[]): void;
    /* A double click on a splitter: its two neighbors even out, or with `all` every column, or every cell of the column. */
    evenColumns(at: number, all: boolean): void;
    evenCells(column: number, at: number, all: boolean): void;
    setBodyFocused(focused: boolean): void;
    addCanvasView(name: string): string;
    /* A line in the sidebar with nothing behind it, to group the views around it. */
    addSeparatorView(): string;
    /* A heading over the rows under it, with nothing behind it either. */
    addSubheaderView(name: string): string;
    /* A sketch of its own. Its elements live in a file of their own, which the daemon keeps. */
    addDrawingView(name: string): string;
    addDiagramView(name: string): string;
    /* A file as a view of its own. `opens` is false for a caller that puts it on the grid itself, such as a loose
       view that becomes this one: opening it first would take the cell that has the focus. */
    addFileView(name: string, path: string, opens?: boolean): string;
    /* A table of a database connection as a view of its own; `opens` means the same as for a file. */
    addDatabaseView(name: string, table: ProjectDatabaseTarget, opens?: boolean): string;
    /* A chat, terminal or browser without a canvas under it. The id is the session id, as for a node. */
    addStandaloneView(view: StandaloneRequest): string;
    /* An artifact of this machine's Output as a view; `opens` means the same as for a file. */
    addArtifactView(name: string, artifact: NonNullable<StandaloneNode['artifact']>, opens?: boolean): string;
    /* A further chat on the folder of a design; false when the view is no design (any more). */
    addDesignChat(viewId: string, chat: DesignChat): boolean;
    renameView(id: string, name: string, source?: NodeTitleSource | null): void;
    /* Overrules the mark a view wears in the lists; null hands it back to its kind. */
    setViewIcon(id: string, icon: ProjectIconChoice | null): void;
    deleteView(id: string): void;
    /* Deletes a view the way `deleteView` does, but holds on to it for `restoreView`. False when there is no such view. */
    trashView(id: string): boolean;
    /* Puts a trashed view back where it stood, in the list and on the grid. False when it is no longer trashed. */
    restoreView(id: string): boolean;
    /* Lets the trashed view with this id go for good, or every one of them; the file loses it with the next save. */
    purgeTrash(id?: string): void;
    duplicateView(id: string): string | null;
    moveView(id: string, toIndex: number): void;
    /* Moves a node from the canvas it sits on to another canvas view, keeping its id and its session. */
    moveNodeToView(nodeId: string, viewId: string): void;
    /* A rename needs no editor: a canvas on no cell has the name written into the view kept here. */
    renameNodeOnView(viewId: string, nodeId: string, title: string, source?: NodeTitleSource | null): void;
    /* Changes what a standalone view carries (its folder, its page) without touching the list. */
    updateStandalone(id: string, patch: Partial<StandaloneNode> & { url?: string }): void;
    /* Lifts a node off its canvas into a view of its own, id and session included. */
    openAsView(nodeId: string): string | null;
    /* Puts a standalone view back on a canvas as a node, in the middle of what that canvas looked at. */
    putOnCanvas(viewId: string, canvasViewId: string): boolean;

    /* The views as they would be saved: the canvas on screen written back into the view it belongs to. */
    exportViews(): ProjectView[];
    /* What the project file holds: the exported views with the trashed ones still in their place. */
    fileViews(): ProjectView[];
    exportLocal(): Pick<ProjectLocal, 'activeViewId' | 'views' | 'layout' | 'emptyLayout'>;
}

/*
 * Every view of the project that is open, and which one is on screen. The canvas store edits one
 * canvas view at a time; this store owns the list, hands the canvas its view on a switch and takes
 * the edits back before the next one loads.
 */
export function createDocumentStore(peers: DocumentPeers): StoreApi<DocumentState> {
    return createStore<DocumentState>((set, get) => {
        const kit = createDocumentKit(set, get, peers);
        return {
            views: [],
            activeViewId: null,
            layout: null,
            emptyLayout: false,
            maximized: null,
            lastCanvasViewId: null,
            lastHostViewId: null,
            viewLocal: {},
            bodyFocused: false,
            viewNotice: null,
            edits: 0,
            loading: false,
            merging: false,
            reloading: false,
            shared: [],
            flags: {},
            accounts: {},
            trashed: [],

            ...createDocumentContentSlice(kit),
            ...createDocumentGridSlice(kit),
            ...createDocumentTabsSlice(kit),
            ...createDocumentNoticeSlice(kit),
            ...createDocumentViewsSlice(kit),
            ...createDocumentNodesSlice(kit)
        };
    });
}

export const defaultDocumentStore = createDocumentStore({ canvases: defaultCanvases, drawings: defaultDrawings, diagrams: defaultDiagrams });

export const useDocument = storeHook(defaultDocumentStore);

/*
 * Whether the cell a component is drawn in has the focus; true outside a cell. A body that takes the
 * keyboard asks this first, because a DOM focus in a cell beside it moves the grid's focus there.
 */
export function useCellHasFocus(): boolean {
    const cell = useContext(CellViewContext);
    return useDocument((s) => cell === null || s.activeViewId === cell);
}

/* The view a node sits on, so a jump from anywhere can switch to it first. A later chat of a design sits where its design does. */
export function viewOfNode(views: readonly ProjectView[], nodesOf: (view: ProjectView) => readonly ProjectNode[], nodeId: string): ProjectView | null {
    const holds = (view: ProjectView): boolean => {
        if (isCanvasView(view)) {
            return nodesOf(view).some((node) => node.id === nodeId || (node.kind === 'design' && nodeChats(node).some((chat) => chat.id === nodeId)));
        }

        return view.id === nodeId || (isDesignView(view) && viewChats(view).some((chat) => chat.id === nodeId));
    };

    return views.find(holds) ?? null;
}

export function activeViewOf(state: Pick<DocumentState, 'views' | 'activeViewId'>): ProjectView | null {
    return cellViewOf(state, state.activeViewId);
}

export function hasActiveCanvas(state: Pick<DocumentState, 'views' | 'activeViewId'>): boolean {
    const view = activeViewOf(state);
    return view !== null && isCanvasView(view);
}
