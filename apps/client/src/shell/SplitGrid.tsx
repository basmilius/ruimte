import { rectDropPreview, SplitView, tabDropPreview, tabGapAt, type SplitCommand, type SplitRect, type TabDrop } from '@adecore/ui';
import { isCanvasView } from '@ruimte/contracts';
import { useEffect, useState, type DragEvent as ReactDragEvent, type ReactElement } from 'react';
import { placeFilesAction, placeViewAction } from '@/actions/client-actions';
import { carriesFiles, carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { PromptStack } from '@/canvas/PromptStack';
import { carriesDatabase, droppedDatabase } from '@/database/drag';
import { dropDatabaseTab } from '@/database/open';
import { cellsMoved, registerCell } from '@/layout/cell-rects';
import { canDropAsTab, canMoveCell, canSplit, cellAt, cellViewIds, locateView, MIN_SHARE, type CellAt, type SplitZone } from '@/layout/split';
import { clampTabLeft, DEFAULT_TAB_WIDTH, gapLeft, positionAfterLifting } from '@/layout/tab-drop';
import { carriesArtifact, dropArtifactTab, droppedArtifact } from '@/output/artifact-drag';
import { isLooseView } from '@/shell/cell-view';
import { CellOverlay } from '@/shell/CellOverlay';
import { CellToolbar } from '@/shell/CellToolbar';
import { cellForPane, columnForSplit, coreLayout } from '@/shell/core-layout';
import { carriesDiff, droppedDiff } from '@/shell/diff-drag';
import { Dock } from '@/shell/Dock';
import { hideDropPreview, showDropPreview } from '@/shell/drop-preview';
import { useCellView } from '@/shell/use-cell-view';
import {
    carriesView,
    draggedViewId,
    dragging,
    draggingTabWidth,
    draggingWholeCell,
    isNowhereDrop,
    pathZoneAt,
    setGridTakesPath,
    shapeOf,
    shapeRect,
    zoneAt
} from '@/shell/view-drag';
import { ViewSurface } from '@/shell/ViewHost';
import { currentEndpointId } from '@/state/current-endpoint';
import { canStandInCell, useDocument } from '@/state/document';
import { tabKey, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { CellViewContext } from '@/state/workspace-stores';

/*
 * What a surface inside a cell says about the paths dropped on it, so the grid does not carry a list
 * of which view kinds handle a drop. `all` keeps the grid out entirely (a chat's composer, which
 * mentions the file); `middle` leaves the grid the strip along the edge and takes the rest (the
 * canvas, which makes a node of it); `files` is `middle` for a drag out of the file manager only and
 * leaves a path dragged inside the window to the surface around it (a terminal, which types the path).
 * Other surfaces let the grid split or replace the view.
 */
function takesDrop(target: EventTarget | null, fromFileManager: boolean): string | null {
    let surface = (target as HTMLElement | null)?.closest?.('[data-takes-drop]') ?? null;
    while (surface !== null) {
        const takes = surface.getAttribute('data-takes-drop');
        if (takes !== 'files') {
            return takes;
        }
        if (fromFileManager) {
            return 'middle';
        }
        surface = surface.parentElement?.closest('[data-takes-drop]') ?? null;
    }
    return null;
}

/* The box of an element in the grid's coordinates, which the drop preview is drawn in. */
function boxInGrid(element: Element, grid: DOMRect): SplitRect {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.left - grid.left), y: Math.round(box.top - grid.top), width: Math.round(box.width), height: Math.round(box.height) };
}

/*
 * The preview of a split or a trade reaches over the column, since a side drop makes a whole new
 * column. The boxes are measured, because a cell carries a bar its share knows nothing about. A
 * maximized cell stands over the whole grid, so the grid is its column.
 */
function previewZone(cell: HTMLElement, zone: SplitZone, filling: boolean): void {
    const grid = cell.closest('[data-split-grid]')!.getBoundingClientRect();
    const at = locateView(useDocument.getState().layout!, cell.dataset.viewId!);
    const peers =
        at === null
            ? []
            : Array.from(cell.closest('[data-split-grid]')!.querySelectorAll<HTMLElement>(`[data-split-cell][data-column="${at.column}"]`)).filter(
                  (peer) => !peer.closest('[hidden]')
              );
    const boxes = peers.map((peer) => boxInGrid(peer, grid));
    const column =
        filling || boxes.length === 0
            ? { x: 0, y: 0, width: Math.round(grid.width), height: Math.round(grid.height) }
            : { x: Math.min(...boxes.map((box) => box.x)), y: 0, width: boxes[0]!.width, height: Math.round(grid.height) };
    showDropPreview(rectDropPreview(shapeRect(shapeOf(zone), column, boxInGrid(cell, grid))));
}

/* A bar in the top row stands `lift` pixels above its cell, so the tab grows out of the top row and the body is the cell. */
function previewTab(cell: HTMLElement, drop: LiftedTabDrop): void {
    const grid = cell.closest('[data-split-grid]')!.getBoundingClientRect();
    const box = boxInGrid(cell, grid);
    showDropPreview(tabDropPreview(drop, { x: box.x, y: box.y - drop.lift }));
}

/* How far above its cell the cell's bar stands: none on the cell, the top row's height and what lies between in the top row. */
type LiftedTabDrop = TabDrop & { lift: number };

/* The gap between a cell's title and the tab that would stand after it, the same as the bar's own spacing. */
const TITLE_GAP = 8;

/* The cell's box, kept up to date for the parking layer: one observer per cell, cleared with it. */
const observers = new Map<string, ResizeObserver>();

function watchCell(viewId: string, element: HTMLElement | null): void {
    observers.get(viewId)?.disconnect();
    observers.delete(viewId);
    registerCell(viewId, element);
    if (element === null || typeof ResizeObserver === 'undefined') {
        return;
    }
    const observer = new ResizeObserver(() => cellsMoved());
    observer.observe(element);
    observers.set(viewId, observer);
}

/*
 * A view and its cell chrome share a stable host while the grid moves them. The context selects
 * its canvas, drawing and diagram stores independently of which pane currently has focus.
 */
function Cell({
    at,
    viewId,
    focused,
    filling,
    hidden
}: {
    at: CellAt;
    viewId: string;
    focused: boolean;
    /* Maximized: drawn over the whole grid, while its own place in the column stays held. */
    filling: boolean;
    /* Behind a maximized cell. Still mounted, so its session and its page keep running. */
    hidden: boolean;
}) {
    const view = useCellView(viewId);
    const [dockHidden, setDockHidden] = useState(false);
    const tabs = useDocument((s) => (s.layout === null ? undefined : cellAt(s.layout, at)?.tabs));

    /* A drag that is about a view of this window, which a file tab is as well as a path: over a surface that has
       a use for the path itself (the canvas, a composer) the path is what counts, anywhere else the view. A drag
       out of the file manager is about files alone. */
    const usesPaths = (event: ReactDragEvent<HTMLElement>): boolean => {
        const transfer = event.dataTransfer;
        if (carriesFiles(transfer.types)) {
            return true;
        }
        return carriesPaths(transfer.types) && !(carriesView(transfer) && dragging() !== null && takesDrop(event.target, false) === null);
    };

    // Only inside the drop event: the shell names a file manager's files from items that are emptied right after.
    const pathsOf = (event: ReactDragEvent<HTMLElement>): string[] =>
        carriesPaths(event.dataTransfer.types) ? droppedPaths(event.dataTransfer) : finderPaths(event.dataTransfer, currentEndpointId());

    const overBar = (event: ReactDragEvent<HTMLElement>): boolean =>
        (carriesView(event.dataTransfer) || carriesPaths(event.dataTransfer.types) || carriesFiles(event.dataTransfer.types)) &&
        ((event.target as HTMLElement | null)?.closest?.('[data-cell-bar]') ?? null) !== null;

    /* Where the pointer would put a tab, or null when the bar cannot take this drag. A whole cell
       is not a tab, and a view that fills this cell alone has nowhere to go in it. */
    const tabDropFor = (event: ReactDragEvent<HTMLElement>): LiftedTabDrop | null => {
        const layout = useDocument.getState().layout;
        if (layout === null) {
            return null;
        }
        const moving = dragging();
        if (!carriesDiff(event.dataTransfer) && !carriesDatabase(event.dataTransfer) && !carriesArtifact(event.dataTransfer) && !usesPaths(event)) {
            if (moving === null || draggingWholeCell() || !canStandInCell(useDocument.getState(), moving) || !canDropAsTab(layout, at, moving)) {
                return null;
            }
        }
        const bar = (event.target as HTMLElement).closest('[data-cell-bar]')!;
        const rects = [...bar.querySelectorAll('[data-tab-id]')].map((tab) => tab.getBoundingClientRect());
        const gap = tabGapAt(rects, event.clientX);
        const barBox = bar.getBoundingClientRect();
        const strip = bar.querySelector('[data-tab-strip]');
        const bounds = strip === null ? barBox : strip.getBoundingClientRect();
        const tabWidth = Math.min(draggingTabWidth() ?? DEFAULT_TAB_WIDTH, Math.round(bounds.right - bounds.left));
        // A plain cell becomes a host of its view and this one, so the tab goes after the title.
        const titleEnd = bar.querySelector('[data-pane-title]')?.lastElementChild?.getBoundingClientRect().right ?? barBox.left;
        const wanted = strip === null ? titleEnd + TITLE_GAP : gapLeft(rects, gap, bounds.left);
        const cellBox = event.currentTarget.getBoundingClientRect();
        // The bar of a lone cell stands in the top row, outside the cell, whose events still reach it through the portal.
        const lift = event.currentTarget.contains(bar) ? 0 : Math.round(cellBox.top - barBox.top);
        return {
            gap,
            left: Math.round(clampTabLeft(wanted, tabWidth, bounds) - cellBox.left),
            tabWidth,
            width: Math.round(cellBox.width),
            height: Math.round(cellBox.height) + lift,
            barHeight: lift > 0 ? lift : Math.round(barBox.height),
            lift
        };
    };

    /* The position among the tabs the drop leaves, which only a host has an order for. */
    const tabIndexFor = (gap: number, moving: string): number | null => {
        const layout = useDocument.getState().layout;
        const cell = layout === null ? null : cellAt(layout, at);
        return cell?.tabs === undefined ? null : positionAfterLifting(cell.tabs, gap, moving);
    };

    /* Where the drag would land, or null for a drop the grid cannot take: the pointer then reads
       `no-drop` and nothing lights up. A target that is not there needs no explanation. */
    const zoneFor = (event: ReactDragEvent<HTMLElement>): SplitZone | null => {
        if (!carriesView(event.dataTransfer)) {
            return null;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const here = zoneAt(box, { x: event.clientX - box.left, y: event.clientY - box.top });
        const layout = useDocument.getState().layout;
        // The payload is kept from the page during a drag, so the limit is asked about the view the
        // grid knows is moving, which for a drag out of the sidebar is no view in the grid at all.
        const moving = dragging();
        if (layout === null) {
            return null;
        }
        // A change dropped in the middle of a cell opens as a tab of it, whatever the cell holds.
        if (here === 'center' && (carriesDiff(event.dataTransfer) || carriesDatabase(event.dataTransfer) || carriesArtifact(event.dataTransfer))) {
            return here;
        }
        // The bar of a host carries every tab, so the question is whether the whole cell fits there.
        const from = moving === null ? null : locateView(layout, moving);
        if (draggingWholeCell()) {
            return from !== null && canMoveCell(layout, from, at, here) ? here : null;
        }
        return canSplit(layout, at, here, moving) && !isNowhereDrop(from, at, here) ? here : null;
    };

    const pathZoneFor = (event: ReactDragEvent<HTMLElement>): SplitZone | null => {
        const box = event.currentTarget.getBoundingClientRect();
        const spot = { x: event.clientX - box.left, y: event.clientY - box.top };
        const here = pathZoneAt(box, spot, takesDrop(event.target, carriesFiles(event.dataTransfer.types)));
        const layout = useDocument.getState().layout;
        return here !== null && layout !== null && canSplit(layout, at, here) ? here : null;
    };

    /* The claim, staked before anything inside the cell sees the drag; the canvas reads it and holds off. */
    const claimPath = (event: ReactDragEvent<HTMLElement>): void => {
        if (!usesPaths(event)) {
            return;
        }
        const claimed = overBar(event) ? tabDropFor(event) !== null : pathZoneFor(event) !== null;
        setGridTakesPath(claimed);
        if (!claimed) {
            /* A surface that takes the drop itself stops the event, so the handler below never runs
               and the hint the grid left standing has to be taken back here. */
            hideDropPreview();
        }
    };

    const dropOnBar = (event: ReactDragEvent<HTMLElement>): void => {
        const tab = tabDropFor(event);
        hideDropPreview();
        setGridTakesPath(false);
        if (tab === null) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const database = droppedDatabase(event.dataTransfer);
        if (database !== null) {
            dropDatabaseTab(database, at, 'center', tabIndexFor(tab.gap, dragging() ?? ''));
            return;
        }
        const artifact = droppedArtifact(event.dataTransfer);
        if (artifact !== null) {
            dropArtifactTab(artifact, at, 'center', tabIndexFor(tab.gap, dragging() ?? ''));
            return;
        }
        if (usesPaths(event)) {
            placeFilesAction(pathsOf(event), viewId, 'center', tabs === undefined ? null : tab.gap);
            return;
        }
        const diff = droppedDiff(event.dataTransfer);
        if (diff !== null) {
            const key = tabKey(diff.path, diff.view);
            useFiles.getState().dropDiff(diff.path, diff.view, useSettings.getState().filesTabLimit, at, 'center', tabIndexFor(tab.gap, key));
            return;
        }
        const dragged = draggedViewId(event.dataTransfer);
        if (dragged !== null) {
            useDocument.getState().dropViewAsTab(dragged, at, tabIndexFor(tab.gap, dragged));
        }
    };

    const dropInZone = (event: ReactDragEvent<HTMLElement>): void => {
        const paths = usesPaths(event) ? pathsOf(event) : [];
        const here = paths.length > 0 ? pathZoneFor(event) : zoneFor(event);
        hideDropPreview();
        setGridTakesPath(false);
        if (here === null) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const database = droppedDatabase(event.dataTransfer);
        if (database !== null) {
            dropDatabaseTab(database, at, here);
            return;
        }
        const artifact = droppedArtifact(event.dataTransfer);
        if (artifact !== null) {
            dropArtifactTab(artifact, at, here);
            return;
        }
        if (paths.length > 0) {
            // A dropped file stays out of the sidebar.
            placeFilesAction(paths, viewId, here);
            return;
        }
        const diff = droppedDiff(event.dataTransfer);
        if (diff !== null) {
            useFiles.getState().dropDiff(diff.path, diff.view, useSettings.getState().filesTabLimit, at, here);
            return;
        }
        const dragged = draggedViewId(event.dataTransfer);
        const layout = useDocument.getState().layout;
        const from = dragged === null || layout === null ? null : locateView(layout, dragged);
        if (draggingWholeCell() && from !== null) {
            useDocument.getState().moveCellTo(from, at, here);
        } else if (dragged === viewId && (layout === null || cellViewIds(cellAt(layout, at)!).length === 1)) {
            // Only a view that fills its cell alone is back where it was; the active tab of a host leaves it.
            useDocument.getState().focusCellAt(at);
        } else if (dragged !== null) {
            placeViewAction(dragged, viewId, here);
        }
    };

    if (view === null) {
        return null;
    }
    const body = (
        /* Registered so the parking layer can put a browser page over this box; its size changes
           with a splitter drag, which moves no state at all, hence the observer. A cell hidden behind
           a maximized one leaves the registry, which hides its pages without moving a <webview>. */
        <div ref={(element) => watchCell(viewId, hidden ? null : element)} className="split-cell-body relative min-h-0 grow overflow-hidden">
            <ViewSurface view={view} />
            <CellOverlay slot="cell">
                {/* The dock belongs to the canvas under it, so it is drawn in the cell that has the
                    focus and nowhere else: nine docks would be nine rows of the same buttons. */}
                {focused && !hidden && <Dock onHiddenChange={setDockHidden} />}
                {/* A stack per canvas, not per dock: a cell without the focus has no dock, and its prompts still need a place. */}
                {!hidden && !isLooseView(view) && isCanvasView(view) && <PromptStack viewId={viewId} dockShown={focused && !dockHidden} />}
            </CellOverlay>
        </div>
    );
    return (
        <CellViewContext.Provider value={viewId}>
            <div
                data-split-cell
                data-view-id={viewId}
                data-column={at.column}
                style={{ borderRadius: 'inherit' }}
                data-maximized={filling ? '' : undefined}
                className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                // A press anywhere in a cell is what moves the focus to it, the way it moves between panels.
                onPointerDownCapture={() => useDocument.getState().focusCellAt(at)}
                /* A press inside a <webview> never reaches this page, only the focus it takes does. The
                   preview of an HTML file is one, and Tab into anything in the cell counts the same. */
                onFocusCapture={() => useDocument.getState().focusCellAt(at)}
                onDragOverCapture={claimPath}
                onDropCapture={claimPath}
                onDragOver={(event) => {
                    if (overBar(event)) {
                        const tab = tabDropFor(event);
                        if (tab !== null) {
                            // Only a prevented dragover accepts the drop.
                            event.preventDefault();
                        }
                        event.dataTransfer.dropEffect = tab === null ? 'none' : usesPaths(event) ? dropEffectFor(event.dataTransfer.effectAllowed) : 'move';
                        if (tab === null) {
                            hideDropPreview();
                        } else {
                            previewTab(event.currentTarget, tab);
                        }
                        return;
                    }
                    const paths = usesPaths(event);
                    const next = paths ? pathZoneFor(event) : zoneFor(event);
                    if (next === null) {
                        hideDropPreview();
                        return;
                    }
                    /* Only a prevented dragover accepts the drop, and only with an effect the source
                       allows: a 'copy' against the file tree's `move` silently drops nothing. */
                    event.preventDefault();
                    event.dataTransfer.dropEffect = paths ? dropEffectFor(event.dataTransfer.effectAllowed) : 'move';
                    previewZone(event.currentTarget, next, filling);
                }}
                onDragLeave={(event) => {
                    // A drag crossing into a child fires leave on the parent; only leaving the cell counts.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setGridTakesPath(false);
                        // Not at once: the pointer may be on its way to the next cell, and the preview then glides there.
                        hideDropPreview(true);
                    }
                }}
                onDrop={(event) => (overBar(event) ? dropOnBar(event) : dropInZone(event))}
            >
                <CellToolbar at={at} view={view} focused={focused} hidden={hidden}>
                    {body}
                </CellToolbar>
            </div>
        </CellViewContext.Provider>
    );
}

function applyCommand(command: SplitCommand): void {
    const document = useDocument.getState();
    if (command.type === 'focus') {
        const at = cellForPane(command.paneId);
        if (at !== null) {
            document.focusCellAt(at);
        }
    } else if (command.type === 'equalizeAxis') {
        if (command.axis === 'horizontal') {
            document.evenColumns(1, true);
        } else {
            document.layout?.columns.forEach((_, column) => document.evenCells(column, 1, true));
        }
    } else if (command.type === 'resize' || command.type === 'equalize') {
        const column = columnForSplit(command.splitId);
        if (command.type === 'resize') {
            if (column === null) {
                document.resizeColumns(command.sizes);
            } else {
                document.resizeCells(column, command.sizes);
            }
        } else {
            const at = (command.index ?? 0) + 1;
            const all = command.index === undefined;
            if (column === null) {
                document.evenColumns(at, all);
            } else {
                document.evenCells(column, at, all);
            }
        }
    }
}

/*
 * The views of one project beside each other: columns of cells, at most three by three. The model
 * and its limits are pure (`shell/split.ts`); this only draws what the layout says and hands a drag
 * back to it.
 */
export function SplitGrid(): ReactElement | null {
    const layout = useDocument((s) => s.layout);
    const maximizedId = useDocument((s) => s.maximized);
    useEffect(() => {
        /* A drag called off with Escape ends with neither a leave nor a drop, so a claim left
           standing would hold the canvas off on the next drag that has nothing to do with it. */
        const clear = (): void => {
            setGridTakesPath(false);
            hideDropPreview();
        };
        window.addEventListener('dragend', clear);
        window.addEventListener('drop', clear);
        return () => {
            window.removeEventListener('dragend', clear);
            window.removeEventListener('drop', clear);
            hideDropPreview();
        };
    }, []);
    if (layout === null) {
        return null;
    }
    const value = coreLayout(layout, maximizedId);
    return (
        <SplitView
            data-split-grid
            value={value}
            onValueChange={(_, command) => applyCommand(command)}
            showTabs={false}
            minimumSize={{ width: 0, height: 0 }}
            minimumResizeShare={MIN_SHARE}
            onViewBoundsChange={() => cellsMoved()}
            renderView={(viewId, info) => {
                const at = cellForPane(info.paneId)!;
                return (
                    <Cell
                        at={at}
                        viewId={viewId}
                        focused={value.focused === info.paneId && info.active}
                        filling={value.maximized === info.paneId}
                        hidden={!info.active}
                    />
                );
            }}
        />
    );
}
