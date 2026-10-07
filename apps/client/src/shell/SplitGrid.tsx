import { Fragment, useEffect, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { isCanvasView, type SplitLayout } from '@ruimte/contracts';
import { PromptStack } from '@/canvas/PromptStack';
import { carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { carriesDiff, droppedDiff } from '@/shell/diff-drag';
import { isLooseView } from '@/shell/cell-view';
import { useCellView } from '@/shell/use-cell-view';
import { placeFilesAction, placeViewAction } from '@/actions/client-actions';
import { canStandInCell, useDocument } from '@/state/document';
import { tabKey, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { CellViewContext } from '@/state/workspace-stores';
import {
    canDropAsTab,
    canMoveCell,
    canSplit,
    cellAt,
    cellCount,
    cellViewIds,
    isSameCell,
    locateView,
    draggedSizes,
    maximizedCell,
    type CellAt,
    type SplitZone
} from '@/shell/split';
import {
    clampTabLeft,
    DEFAULT_TAB_WIDTH,
    gapAt,
    gapLeft,
    positionAfterLifting,
    rectPreview,
    tabPreview,
    type PreviewRect,
    type TabDrop
} from '@/shell/tab-drop';
import { hideDropPreview, showDropPreview } from '@/shell/drop-preview';
import type { SplitCell } from '@ruimte/contracts';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Button, Kbd, Surface, Tooltip } from '@adecore/ui';
import {
    carriesView,
    draggedViewId,
    dragging,
    draggingTabWidth,
    draggingWholeCell,
    edgeZoneAt,
    isNowhereDrop,
    setGridTakesPath,
    shapeOf,
    shapeRect,
    zoneAt
} from '@/shell/view-drag';
import { ViewSurface } from '@/shell/ViewHost';
import { CellToolbar } from '@/shell/CellToolbar';
import { cellsMoved, registerCell } from '@/shell/cell-rects';
import { Dock } from '@/shell/Dock';
import { CellOverlay } from '@/shell/CellOverlay';

/* The smallest a cell may be dragged to, as a share of its axis. Below this nothing in it is legible. */

/*
 * What a surface inside a cell says about the paths dropped on it, so the grid does not carry a list
 * of which view kinds handle a drop. `all` keeps the grid out entirely (a chat's composer, which
 * mentions the file); `middle` leaves the grid the strip along the edge and takes the rest (the
 * canvas, which makes a node of it). A surface that says nothing lets the whole cell split.
 */
function takesDrop(target: EventTarget | null): string | null {
    return (target as HTMLElement | null)?.closest?.('[data-takes-drop]')?.getAttribute('data-takes-drop') ?? null;
}

/*
 * Dragging the line in front of item `at` of an axis. Sizes are shares of an axis rather than pixels,
 * so the grid keeps its proportions when the window changes size; the drag measures against the box
 * the items share, which is the only place a share can be turned back into a pointer position.
 * Option is read on every move, so it can be pressed or let go halfway through a drag.
 */
function splitDrag(axis: 'x' | 'y', sizes: readonly number[], at: number, onSizes: (sizes: number[]) => void): (event: ReactPointerEvent<HTMLElement>) => void {
    return (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        // The splitter's parent is the box the items share, which is what a share is a share of.
        const box = handle.parentElement?.getBoundingClientRect();
        const span = axis === 'x' ? (box?.width ?? 0) : (box?.height ?? 0);
        if (span === 0) {
            return;
        }
        const start = axis === 'x' ? event.clientX : event.clientY;
        const total = sizes.reduce((sum, size) => sum + size, 0);
        const onMove = (move: PointerEvent): void => {
            const moved = (((axis === 'x' ? move.clientX : move.clientY) - start) / span) * total;
            onSizes(draggedSizes(sizes, at, moved, span / total, move.altKey));
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };
}

/* A double click evens out the two neighbors, and with Option every column, or every cell of the column.
   Dragging with Option moves the mirroring splitter along, the other way. */
function Splitter({
    axis,
    hidden,
    onPointerDown,
    onEven
}: {
    axis: 'x' | 'y';
    hidden: boolean;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onEven: (all: boolean) => void;
}) {
    return (
        <div
            role="separator"
            aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
            className={clsx(
                'relative shrink-0 bg-border transition-colors hover:bg-accent',
                axis === 'x' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
                hidden && 'invisible'
            )}
            onPointerDown={onPointerDown}
            onDoubleClick={(event) => onEven(event.altKey)}
        >
            {/* The line is one pixel, but nobody can hit one pixel: the grab area reaches past it. */}
            <span className={clsx('absolute', axis === 'x' ? '-inset-x-1 inset-y-0' : 'inset-x-0 -inset-y-1')} />
        </div>
    );
}

/* The box of an element in the grid's coordinates, which the drop preview is drawn in. */
function boxInGrid(element: Element, grid: DOMRect): PreviewRect {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.left - grid.left), y: Math.round(box.top - grid.top), width: Math.round(box.width), height: Math.round(box.height) };
}

/*
 * The preview of a split or a trade, which reaches over the column rather than over the cell the
 * pointer is on: a side drop on a cell in a column of three gives a whole new column. You aim at a
 * cell and get a column, so that has to be visible before the pointer is let go. The boxes are
 * measured rather than derived from a share, because a cell carries a bar the share knows nothing
 * about. A maximized cell stands over the whole grid, so the grid is its column.
 */
function previewZone(cell: HTMLElement, zone: SplitZone, filling: boolean): void {
    const grid = cell.closest('[data-split-grid]')!.getBoundingClientRect();
    const column = filling
        ? { x: 0, y: 0, width: Math.round(grid.width), height: Math.round(grid.height) }
        : boxInGrid(cell.closest('[data-split-column]')!, grid);
    showDropPreview(rectPreview(shapeRect(shapeOf(zone), column, boxInGrid(cell, grid))));
}

function previewTab(cell: HTMLElement, drop: TabDrop): void {
    const grid = cell.closest('[data-split-grid]')!.getBoundingClientRect();
    showDropPreview(tabPreview(drop, boxInGrid(cell, grid)));
}

/* The gap between a cell's title and the tab that would stand after it, the same as the bar's own spacing. */
const TITLE_GAP = 8;

/* What a cell is called in the tree: its first view, which a switch between its tabs never changes, so the bar and its menus stay mounted. */
function cellKey(cell: SplitCell): string {
    return cellViewIds(cell)[0]!;
}

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
 * One cell: the view it holds and nothing about the grid around it. What is inside reads `useCanvas`
 * and `useDrawing` without naming a view, because the context says which one this cell is.
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
       a use for the path itself (the canvas, a composer) the path is what counts, anywhere else the view. */
    const usesPaths = (event: ReactDragEvent<HTMLElement>): boolean => {
        const transfer = event.dataTransfer;
        return carriesPaths(transfer.types) && !(carriesView(transfer) && dragging() !== null && takesDrop(event.target) === null);
    };

    const overBar = (event: ReactDragEvent<HTMLElement>): boolean =>
        carriesView(event.dataTransfer) && ((event.target as HTMLElement | null)?.closest?.('[data-cell-bar]') ?? null) !== null;

    /* Where the pointer would put a tab, or null when the bar cannot take this drag. A whole cell
       is not a tab, and a view that fills this cell alone has nowhere to go in it. */
    const tabDropFor = (event: ReactDragEvent<HTMLElement>): TabDrop | null => {
        const layout = useDocument.getState().layout;
        if (layout === null) {
            return null;
        }
        const moving = dragging();
        if (!carriesDiff(event.dataTransfer)) {
            if (moving === null || draggingWholeCell() || !canStandInCell(useDocument.getState(), moving) || !canDropAsTab(layout, at, moving)) {
                return null;
            }
        }
        const bar = (event.target as HTMLElement).closest('[data-cell-bar]')!;
        const rects = [...bar.querySelectorAll('[data-tab-id]')].map((tab) => tab.getBoundingClientRect());
        const gap = gapAt(rects, event.clientX);
        const barBox = bar.getBoundingClientRect();
        const strip = bar.querySelector('[data-tab-strip]');
        const bounds = strip === null ? barBox : strip.getBoundingClientRect();
        const tabWidth = Math.min(draggingTabWidth() ?? DEFAULT_TAB_WIDTH, Math.round(bounds.right - bounds.left));
        // A plain cell becomes a host of its view and this one, so the tab goes after the title.
        const titleEnd = bar.querySelector('[data-cell-title]')?.lastElementChild?.getBoundingClientRect().right ?? barBox.left;
        const wanted = strip === null ? titleEnd + TITLE_GAP : gapLeft(rects, gap, bounds.left);
        const cellBox = event.currentTarget.getBoundingClientRect();
        return {
            gap,
            left: Math.round(clampTabLeft(wanted, tabWidth, bounds) - cellBox.left),
            tabWidth,
            width: Math.round(cellBox.width),
            height: Math.round(cellBox.height),
            barHeight: Math.round(barBox.height)
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
        if (here === 'center' && carriesDiff(event.dataTransfer)) {
            return here;
        }
        // The bar of a host carries every tab, so the question is whether the whole cell fits there.
        const from = moving === null ? null : locateView(layout, moving);
        if (draggingWholeCell()) {
            return from !== null && canMoveCell(layout, from, at, here) ? here : null;
        }
        return canSplit(layout, at, here, moving) && !isNowhereDrop(from, at, here) ? here : null;
    };

    /*
     * Where a path out of the files panel would land, which is always an edge and never the middle:
     * a file dropped on the grid becomes a view of its own, in a cell beside the one it was aimed
     * at. How much of the cell answers is the surface under the pointer's to say, so a cell whose
     * contents do nothing with a path splits over its whole face and a drag over it always has an
     * answer, however large the cell or the page filling it.
     */
    const pathZoneFor = (event: ReactDragEvent<HTMLElement>): SplitZone | null => {
        const taken = takesDrop(event.target);
        if (taken === 'all') {
            return null;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const spot = { x: event.clientX - box.left, y: event.clientY - box.top };
        const here = taken === 'middle' ? zoneAt(box, spot) : edgeZoneAt(box, spot);
        const layout = useDocument.getState().layout;
        return here !== 'center' && layout !== null && canSplit(layout, at, here) ? here : null;
    };

    /* The claim, staked before anything inside the cell sees the drag; the canvas reads it and holds off. */
    const claimPath = (event: ReactDragEvent<HTMLElement>): void => {
        if (!usesPaths(event)) {
            return;
        }
        const zone = pathZoneFor(event);
        setGridTakesPath(zone !== null);
        if (zone === null) {
            /* A surface that takes the drop itself stops the event, so the handler below never runs
               and the hint the grid left standing has to be taken back here. */
            hideDropPreview();
        }
    };

    if (view === null) {
        return null;
    }
    const body = (
        /* Registered so the parking layer can put a browser page over this box; its size changes
           with a splitter drag, which moves no state at all, hence the observer. A cell hidden behind
           a maximized one leaves the registry, which hides its pages without moving a <webview>. */
        <div ref={(element) => watchCell(viewId, hidden ? null : element)} className="relative min-h-0 grow overflow-hidden">
            {/* A host keeps one surface for its loose tabs, which keeps the editors of the tabs shown last. */}
            <ViewSurface view={view} hostIds={tabs} />
            <CellOverlay slot="cell">
                {/* The dock belongs to the canvas under it, so it is drawn in the cell that has the
                    focus and nowhere else: nine docks would be nine rows of the same buttons. */}
                {focused && <Dock onHiddenChange={setDockHidden} />}
                {/* A stack per canvas, not per dock: a cell without the focus has no dock, and its prompts still need a place. */}
                {!isLooseView(view) && isCanvasView(view) && <PromptStack viewId={viewId} dockShown={focused && !dockHidden} />}
                {filling && <MaximizedIndicator at={at} />}
            </CellOverlay>
        </div>
    );
    return (
        <CellViewContext.Provider value={viewId}>
            <div
                className={clsx('flex min-h-0 min-w-0 grow flex-col overflow-hidden', filling && 'absolute inset-0 z-10 bg-bg')}
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
                        event.dataTransfer.dropEffect = tab === null ? 'none' : 'move';
                        if (tab === null) {
                            hideDropPreview();
                        } else {
                            previewTab(event.currentTarget, tab);
                        }
                        return;
                    }
                    const paths = usesPaths(event);
                    const next = paths ? pathZoneFor(event) : zoneFor(event);
                    if (next !== null) {
                        // Only a prevented dragover accepts the drop; without it the browser refuses it.
                        event.preventDefault();
                        /* And the effect has to be one the source allows: the file tree drags with
                           `effectAllowed: 'move'`, and a 'copy' against that makes the operation
                           none, which the browser answers by dropping nothing and saying nothing. */
                        event.dataTransfer.dropEffect = paths ? dropEffectFor(event.dataTransfer.effectAllowed) : 'move';
                    }
                    if (next === null) {
                        hideDropPreview();
                    } else {
                        previewZone(event.currentTarget, next, filling);
                    }
                }}
                onDragLeave={(event) => {
                    // A drag crossing into a child fires leave on the parent; only leaving the cell counts.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setGridTakesPath(false);
                        // Not at once: the pointer may be on its way to the next cell, and the preview then glides there.
                        hideDropPreview(true);
                    }
                }}
                onDrop={(event) => {
                    if (overBar(event)) {
                        const tab = tabDropFor(event);
                        hideDropPreview();
                        setGridTakesPath(false);
                        if (tab === null) {
                            return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
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
                        return;
                    }
                    const paths = usesPaths(event) ? droppedPaths(event.dataTransfer) : [];
                    const here = paths.length > 0 ? pathZoneFor(event) : zoneFor(event);
                    hideDropPreview();
                    setGridTakesPath(false);
                    if (here === null) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (paths.length === 0) {
                        const dragged = draggedViewId(event.dataTransfer);
                        const diff = droppedDiff(event.dataTransfer);
                        if (diff !== null) {
                            useFiles.getState().dropDiff(diff.path, diff.view, useSettings.getState().filesTabLimit, at, here);
                            return;
                        }
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
                        return;
                    }
                    // Keep the file beside this cell without adding it to the sidebar.
                    placeFilesAction(paths, viewId, here);
                }}
            >
                <CellToolbar at={at} view={view} focused={focused}>
                    {body}
                </CellToolbar>
            </div>
        </CellViewContext.Provider>
    );
}

/* What stands in for the cells a maximized one hides: their shape, how many there are, and the way back. */
function MaximizedIndicator({ at }: { at: CellAt }) {
    const { t } = useTranslation('shell');
    const layout = useDocument((s) => s.layout);
    if (layout === null) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute bottom-4 left-4 flex">
            <Tooltip label={t('cellToolbar.restore')} name>
                <Surface render={<Button size="sm" onClick={() => useDocument.getState().toggleMaximized()} />} className="pointer-events-auto">
                    {/* Whole pixels for one, two or three of either, with a pixel between them. */}
                    <span aria-hidden className="flex h-2.75 w-4.25 gap-px">
                        {layout.columns.map((column, columnIndex) => (
                            <span key={cellKey(column.cells[0]!)} className="flex flex-1 flex-col gap-px">
                                {column.cells.map((cell, cellIndex) => (
                                    <span
                                        key={cellKey(cell)}
                                        className={clsx(
                                            'flex-1 rounded-xs',
                                            isSameCell(at, { column: columnIndex, cell: cellIndex }) ? 'bg-text-muted' : 'bg-border-strong'
                                        )}
                                    />
                                ))}
                            </span>
                        ))}
                    </span>
                    {t('cellToolbar.hidden', { count: cellCount(layout) - 1 })}
                    <span aria-hidden>·</span>
                    <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} className="font-sans" />
                </Surface>
            </Tooltip>
        </div>
    );
}

function Column({ layout, at, maximized }: { layout: SplitLayout; at: number; maximized: CellAt | null }) {
    const column = layout.columns[at]!;
    const resize = (cell: number): ((event: ReactPointerEvent<HTMLElement>) => void) =>
        splitDrag(
            'y',
            column.cells.map((entry) => entry.size),
            cell,
            (sizes) => useDocument.getState().resizeCells(at, sizes)
        );
    return (
        /* Not positioned while a cell is maximized, so that cell is drawn against the whole grid. */
        <div
            data-split-column
            className={clsx('flex min-h-0 min-w-0 flex-col', maximized === null ? 'relative' : maximized.column !== at && 'invisible')}
            style={{ flex: `${column.size} 1 0` }}
        >
            {column.cells.map((cell, index) => (
                <Fragment key={cellKey(cell)}>
                    {index > 0 && (
                        <Splitter
                            axis="y"
                            hidden={maximized !== null}
                            onPointerDown={resize(index)}
                            onEven={(all) => useDocument.getState().evenCells(at, index, all)}
                        />
                    )}
                    <div
                        className={clsx('flex min-h-0 flex-col', maximized !== null && !isSameCell(maximized, { column: at, cell: index }) && 'invisible')}
                        style={{ flex: `${cell.size} 1 0` }}
                    >
                        <Cell
                            at={{ column: at, cell: index }}
                            viewId={cell.viewId}
                            focused={isSameCell(layout.focus, { column: at, cell: index })}
                            filling={maximized !== null && isSameCell(maximized, { column: at, cell: index })}
                            hidden={maximized !== null && !isSameCell(maximized, { column: at, cell: index })}
                        />
                    </div>
                </Fragment>
            ))}
        </div>
    );
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
    const maximized = maximizedCell(layout, maximizedId);
    const resize = (column: number): ((event: ReactPointerEvent<HTMLElement>) => void) =>
        splitDrag(
            'x',
            layout.columns.map((entry) => entry.size),
            column,
            (sizes) => useDocument.getState().resizeColumns(sizes)
        );
    return (
        /* Isolated, so a maximized cell stands over its neighbors and never over the parked pages. */
        <div data-split-grid className="absolute inset-0 isolate flex bg-border">
            {layout.columns.map((column, index) => (
                <Fragment key={cellKey(column.cells[0]!)}>
                    {index > 0 && (
                        <Splitter
                            axis="x"
                            hidden={maximized !== null}
                            onPointerDown={resize(index)}
                            onEven={(all) => useDocument.getState().evenColumns(index, all)}
                        />
                    )}
                    <Column layout={layout} at={index} maximized={maximized} />
                </Fragment>
            ))}
        </div>
    );
}
