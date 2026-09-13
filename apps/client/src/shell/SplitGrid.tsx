import { Fragment, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import clsx from 'clsx';
import type { SplitLayout } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { CellViewContext } from '@/state/workspace-stores';
import { canSplit, cellCount, isSameCell, locateView, snapToEven, type CellAt, type SplitZone } from '@/shell/split';
import { carriesView, draggedViewId, dragging, isNowhereDrop, shapeOf, zoneAt } from '@/shell/view-drag';
import { ViewSurface } from '@/shell/ViewHost';
import { CellToolbar } from '@/shell/CellToolbar';
import { cellsMoved, registerCell } from '@/shell/cell-rects';
import { Dock } from '@/shell/Dock';

/* The smallest a cell may be dragged to, as a share of its axis. Below this nothing in it is legible. */
const MIN_SHARE = 0.15;

/*
 * Dragging the line between two columns or two cells. Sizes are shares of an axis rather than pixels,
 * so the grid keeps its proportions when the window changes size; the drag measures against the box
 * the two neighbors share, which is the only place a share can be turned back into a pointer position.
 */
const splitDrag = (
    axis: 'x' | 'y',
    before: number,
    after: number,
    onShares: (before: number, after: number) => void
): ((event: ReactPointerEvent<HTMLElement>) => void) => {
    return (event: ReactPointerEvent<HTMLElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        // The splitter's parent is the box the two neighbors share, which is what a share is a share of.
        const box = handle.parentElement?.getBoundingClientRect();
        const span = axis === 'x' ? (box?.width ?? 0) : (box?.height ?? 0);
        if (span === 0) {
            return;
        }
        const start = axis === 'x' ? event.clientX : event.clientY;
        const total = before + after;
        const onMove = (move: PointerEvent): void => {
            const moved = ((axis === 'x' ? move.clientX : move.clientY) - start) / span;
            const next = snapToEven(Math.max(MIN_SHARE * total, Math.min(total - MIN_SHARE * total, before + moved)), total, span);
            onShares(next, total - next);
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
};

function Splitter({ axis, onPointerDown }: { axis: 'x' | 'y'; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
    return (
        <div
            role="separator"
            aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
            className={clsx(
                'relative shrink-0 bg-border transition-colors hover:bg-accent',
                axis === 'x' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
            )}
            onPointerDown={onPointerDown}
        >
            {/* The line is one pixel, but nobody can hit one pixel: the grab area reaches past it. */}
            <span className={clsx('absolute', axis === 'x' ? '-inset-x-1 inset-y-0' : 'inset-x-0 -inset-y-1')} />
        </div>
    );
}

/*
 * The rectangle the dragged view would take, drawn over the column rather than over the cell the
 * pointer is on: a side drop on a cell in a column of three gives a whole new column. You aim at a
 * cell and get a column, so that has to be visible before the pointer is let go. The cell's own box
 * is measured rather than derived from its share, because a cell carries a bar the share knows
 * nothing about.
 */
function DropIndicator({ box, zone }: { box: { top: number; height: number }; zone: SplitZone }) {
    const shape = shapeOf(zone);
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-sm border-2 border-accent bg-accent/15 transition-all duration-100"
            style={{
                left: `${shape.x * 100}%`,
                width: `${shape.width * 100}%`,
                top: shape.column ? 0 : box.top + shape.y * box.height,
                height: shape.column ? '100%' : shape.height * box.height
            }}
        />
    );
}

/* The cell's box, kept up to date for the parking layer: one observer per cell, cleared with it. */
const observers = new Map<string, ResizeObserver>();

const watchCell = (viewId: string, element: HTMLElement | null): void => {
    observers.get(viewId)?.disconnect();
    observers.delete(viewId);
    registerCell(viewId, element);
    if (element === null || typeof ResizeObserver === 'undefined') {
        return;
    }
    const observer = new ResizeObserver(() => cellsMoved());
    observer.observe(element);
    observers.set(viewId, observer);
};

/*
 * One cell: the view it holds and nothing about the grid around it. What is inside reads `useCanvas`
 * and `useDrawing` without naming a view, because the context says which one this cell is.
 */
function Cell({
    at,
    viewId,
    focused,
    split,
    onZone
}: {
    at: CellAt;
    viewId: string;
    focused: boolean;
    /* More than one cell on screen, which is what gives a cell a bar of its own. */
    split: boolean;
    onZone: (zone: SplitZone | null, box: { top: number; height: number }) => void;
}) {
    const view = useDocument((s) => s.views.find((candidate) => candidate.id === viewId) ?? null);

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
        return layout !== null && canSplit(layout, at, here, moving) && !isNowhereDrop(moving === null ? null : locateView(layout, moving), at, here)
            ? here
            : null;
    };

    /* The cell's box inside the column it stands in, for the indicator to be drawn against. The
       column is the offset parent, so this is what the browser already measured. */
    const boxIn = (element: HTMLElement): { top: number; height: number } => ({ top: element.offsetTop, height: element.offsetHeight });

    if (view === null) {
        return null;
    }
    const body = (
        /* Registered so the parking layer can put a browser page over this box; its size changes
           with a splitter drag, which moves no state at all, hence the observer. */
        <div ref={(element) => watchCell(viewId, element)} className="relative min-h-0 grow overflow-hidden">
            <ViewSurface view={view} />
            {/* The dock belongs to the canvas under it, so it is drawn in the cell that has the
                focus and nowhere else: nine docks would be nine rows of the same buttons. */}
            {focused && <Dock />}
        </div>
    );
    return (
        <CellViewContext.Provider value={viewId}>
            <div
                className="flex min-h-0 min-w-0 grow flex-col overflow-hidden"
                // A press anywhere in a cell is what moves the focus to it, the way it moves between panels.
                onPointerDownCapture={() => useDocument.getState().focusCellAt(at)}
                /* A press inside a <webview> never reaches this page, only the focus it takes does. The
                   preview of an HTML file is one, and Tab into anything in the cell counts the same. */
                onFocusCapture={() => useDocument.getState().focusCellAt(at)}
                onDragOver={(event) => {
                    const next = zoneFor(event);
                    if (next !== null) {
                        // Only a prevented dragover accepts the drop; without it the browser refuses it.
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                    }
                    onZone(next, boxIn(event.currentTarget));
                }}
                onDragLeave={(event) => {
                    // A drag crossing into a child fires leave on the parent; only leaving the cell counts.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        onZone(null, boxIn(event.currentTarget));
                    }
                }}
                onDrop={(event) => {
                    const here = zoneFor(event);
                    const dragged = draggedViewId(event.dataTransfer);
                    onZone(null, boxIn(event.currentTarget));
                    if (here === null || dragged === null) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    useDocument.getState().dropViewAt(dragged, at, here);
                }}
            >
                {/* One cell means the window's toolbar speaks for the view, and a second bar under it
                    would say the same thing twice. */}
                {split ? (
                    <CellToolbar at={at} view={view} focused={focused}>
                        {body}
                    </CellToolbar>
                ) : (
                    body
                )}
            </div>
        </CellViewContext.Provider>
    );
}

function Column({ layout, at }: { layout: SplitLayout; at: number }) {
    const column = layout.columns[at]!;
    /* Which cell the drag is over and where in it. It is held here and not in the cell, because a
       side drop reaches across the whole column and the indicator is drawn against that box. */
    const [drop, setDrop] = useState<{ zone: SplitZone; box: { top: number; height: number } } | null>(null);
    const resize = (cell: number): ((event: ReactPointerEvent<HTMLElement>) => void) =>
        splitDrag('y', column.cells[cell - 1]!.size, column.cells[cell]!.size, (before, after) => useDocument.getState().resizeCells(at, cell, before, after));
    return (
        <div className="relative flex min-h-0 min-w-0 flex-col" style={{ flex: `${column.size} 1 0` }}>
            {drop !== null && <DropIndicator box={drop.box} zone={drop.zone} />}
            {column.cells.map((cell, index) => (
                <Fragment key={cell.viewId}>
                    {index > 0 && <Splitter axis="y" onPointerDown={resize(index)} />}
                    <div className="flex min-h-0 flex-col" style={{ flex: `${cell.size} 1 0` }}>
                        <Cell
                            at={{ column: at, cell: index }}
                            viewId={cell.viewId}
                            focused={isSameCell(layout.focus, { column: at, cell: index })}
                            split={cellCount(layout) > 1}
                            onZone={(zone, box) => setDrop(zone === null ? null : { zone, box })}
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
    if (layout === null) {
        return null;
    }
    const resize = (column: number): ((event: ReactPointerEvent<HTMLElement>) => void) =>
        splitDrag('x', layout.columns[column - 1]!.size, layout.columns[column]!.size, (before, after) =>
            useDocument.getState().resizeColumns(column, before, after)
        );
    return (
        <div className="absolute inset-0 flex bg-border">
            {layout.columns.map((column, index) => (
                <Fragment key={column.cells[0]!.viewId}>
                    {index > 0 && <Splitter axis="x" onPointerDown={resize(index)} />}
                    <Column layout={layout} at={index} />
                </Fragment>
            ))}
        </div>
    );
}
