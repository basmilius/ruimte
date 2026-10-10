import { isOpenableView, type ProjectLocal, type ProjectView, type SplitCell, type SplitColumn, type SplitLayout } from '@ruimte/contracts';

/* Columns of cells instead of a free tree, so "at most three by three" is these two numbers and every layout the model can express is allowed. */
export const MAX_COLUMNS = 3;
export const MAX_CELLS = 3;

/* A cell has five drop points: the four edges split, the middle takes over the view standing there. */
export type SplitZone = 'left' | 'right' | 'up' | 'down' | 'center';
export type SplitDirection = Exclude<SplitZone, 'center'>;

export interface CellAt {
    column: number;
    cell: number;
}

function isColumnZone(zone: SplitZone): boolean {
    return zone === 'left' || zone === 'right';
}

/* Sizes are shares of an axis, so whatever a hand-edited file leaves behind falls back to an even split. */
function normalize<T extends { size: number }>(items: readonly T[]): T[] {
    if (items.length === 0) {
        return [];
    }
    const validSize = (size: number): number => (Number.isFinite(size) && size > 0 ? size : 0);
    const total = items.reduce((sum, item) => sum + validSize(item.size), 0);
    if (total <= 0) {
        return items.map((item) => ({ ...item, size: 1 / items.length }));
    }
    return items.map((item) => ({ ...item, size: validSize(item.size) / total }));
}

function clampFocus(columns: readonly SplitColumn[], focus: CellAt): CellAt {
    const column = Math.min(Math.max(focus.column, 0), columns.length - 1);
    const cells = columns[column]?.cells.length ?? 1;
    return { column, cell: Math.min(Math.max(focus.cell, 0), cells - 1) };
}

/* Every operation ends here: shares add up again and the focus lands on a cell that still exists. */
function settled(columns: readonly SplitColumn[], focus: CellAt): SplitLayout {
    const settledColumns = normalize(columns).map((column) => ({ ...column, cells: normalize(column.cells) }));
    return { columns: settledColumns, focus: clampFocus(settledColumns, focus) };
}

export function singleLayout(viewId: string): SplitLayout {
    return {
        columns: [{ size: 1, cells: [{ viewId, size: 1 }] }],
        focus: { column: 0, cell: 0 }
    };
}

export function cellCount(layout: SplitLayout): number {
    return layout.columns.reduce((total, column) => total + column.cells.length, 0);
}

export function isTabHost(cell: SplitCell): boolean {
    return cell.tabs !== undefined;
}

/* The views of a cell in order; `viewId` is the one that is drawn. */
export function cellViewIds(cell: SplitCell): string[] {
    return cell.tabs === undefined ? [cell.viewId] : cell.tabs;
}

/* Every view in the layout, background tabs included: this answers whether a view is placed. */
export function viewIdsIn(layout: SplitLayout): string[] {
    return layout.columns.flatMap((column) => column.cells.flatMap(cellViewIds));
}

export function shownViewIdsIn(layout: SplitLayout): string[] {
    return layout.columns.flatMap((column) => column.cells.map((cell) => cell.viewId));
}

export function cellAt(layout: SplitLayout, at: CellAt): SplitCell | null {
    return layout.columns[at.column]?.cells[at.cell] ?? null;
}

export function isSameCell(one: CellAt, other: CellAt): boolean {
    return one.column === other.column && one.cell === other.cell;
}

/* One view stands in at most one cell, as its view or as one of its tabs, so this answers with the cell or with nothing. */
export function locateView(layout: SplitLayout, viewId: string): CellAt | null {
    for (let column = 0; column < layout.columns.length; column += 1) {
        const cell = layout.columns[column].cells.findIndex((candidate) => cellViewIds(candidate).includes(viewId));
        if (cell !== -1) {
            return { column, cell };
        }
    }
    return null;
}

export function focusedViewId(layout: SplitLayout): string | null {
    return cellAt(layout, layout.focus)?.viewId ?? null;
}

/* What a cell holds without its share of the column, which is what travels when a cell moves. */
type CellContent = Pick<SplitCell, 'viewId' | 'tabs'>;

function contentOf(cell: SplitCell): CellContent {
    return cell.tabs === undefined ? { viewId: cell.viewId } : { viewId: cell.viewId, tabs: cell.tabs };
}

function replaceCell(columns: readonly SplitColumn[], at: CellAt, next: SplitCell): SplitColumn[] {
    return columns.map((column, columnIndex) =>
        columnIndex === at.column ? { ...column, cells: column.cells.map((cell, cellIndex) => (cellIndex === at.cell ? next : cell)) } : column
    );
}

/* Where a cell leaves a tab, the active tab only moves when it was the one that left: right neighbor first, else left. */
function withoutTab(cell: SplitCell, viewId: string): SplitCell {
    const tabs = cellViewIds(cell);
    const index = tabs.indexOf(viewId);
    if (index === -1 || tabs.length === 1) {
        return cell;
    }
    const active = cell.viewId === viewId ? (tabs[index + 1] ?? tabs[index - 1]) : cell.viewId;
    return { ...cell, viewId: active, tabs: tabs.filter((id) => id !== viewId) };
}

function renamedIn(cell: SplitCell, from: string, to: string): SplitCell {
    const next = { ...cell, viewId: cell.viewId === from ? to : cell.viewId };
    if (cell.tabs !== undefined) {
        next.tabs = cell.tabs.map((id) => (id === from ? to : id));
    }
    return next;
}

/*
 * The shared test behind a drop on a zone. `source` is the cell the dragged view stands in and
 * `leavesCell` says whether the drop empties it: a tab among several leaves only its tab, so it
 * frees no cell and no column, and a drop on the edge of its own host is a split, not nothing.
 */
function canPlace(layout: SplitLayout, at: CellAt, zone: SplitZone, source: CellAt | null, leavesCell: boolean): boolean {
    if (cellAt(layout, at) === null) {
        return false;
    }
    if (source !== null && isSameCell(source, at) && (zone === 'center' || leavesCell)) {
        return false;
    }
    if (zone === 'center') {
        return true;
    }
    if (isColumnZone(zone)) {
        const freed = source !== null && leavesCell && layout.columns[source.column].cells.length === 1 ? 1 : 0;
        return layout.columns.length - freed < MAX_COLUMNS;
    }
    const leaving = source !== null && leavesCell && source.column === at.column ? 1 : 0;
    return layout.columns[at.column].cells.length - leaving < MAX_CELLS;
}

/* Whether the whole cell at `from` may land in the zone of the cell at `at`, which is what dragging a host by its bar asks. */
export function canMoveCell(layout: SplitLayout, from: CellAt, at: CellAt, zone: SplitZone): boolean {
    return cellAt(layout, from) !== null && canPlace(layout, at, zone, from, true);
}

function fillsCellAlone(layout: SplitLayout, source: CellAt): boolean {
    return cellViewIds(cellAt(layout, source)!).length === 1;
}

/*
 * Whether a drop on this zone would land. A `moving` view that fills its cell alone takes the cell
 * along, so a layout that looks full may have room; a drop on the cell it already sits in is nothing.
 */
export function canSplit(layout: SplitLayout, at: CellAt, zone: SplitZone, moving: string | null = null): boolean {
    const source = moving === null ? null : locateView(layout, moving);
    return canPlace(layout, at, zone, source, source !== null && fillsCellAlone(layout, source));
}

/* A column that loses its last cell is gone, so the target moves up when it sat behind that column. */
function withoutCell(columns: readonly SplitColumn[], source: CellAt, target: CellAt): { columns: SplitColumn[]; target: CellAt } {
    const next = columns.map((column, index) =>
        index === source.column ? { ...column, cells: column.cells.filter((_, cell) => cell !== source.cell) } : column
    );
    const emptied = next[source.column].cells.length === 0;
    return {
        columns: emptied ? next.filter((_, index) => index !== source.column) : next,
        target: {
            column: emptied && source.column < target.column ? target.column - 1 : target.column,
            cell: source.column === target.column && source.cell < target.cell ? target.cell - 1 : target.cell
        }
    };
}

/* A new cell beside `target` on one of its four edges, half of the share the target had. */
function splitAt(columns: readonly SplitColumn[], target: CellAt, zone: Exclude<SplitZone, 'center'>, content: CellContent): SplitLayout {
    if (isColumnZone(zone)) {
        const half = columns[target.column].size / 2;
        const index = zone === 'left' ? target.column : target.column + 1;
        const next = columns.map((column, columnIndex) => (columnIndex === target.column ? { ...column, size: half } : column));
        next.splice(index, 0, { size: half, cells: [{ ...content, size: 1 }] });
        return settled(next, { column: index, cell: 0 });
    }
    const column = columns[target.column];
    const half = column.cells[target.cell].size / 2;
    const index = zone === 'up' ? target.cell : target.cell + 1;
    const cells = column.cells.map((cell, cellIndex) => (cellIndex === target.cell ? { ...cell, size: half } : cell));
    cells.splice(index, 0, { ...content, size: half });
    const next = columns.map((candidate, columnIndex) => (columnIndex === target.column ? { ...candidate, cells } : candidate));
    return settled(next, { column: target.column, cell: index });
}

/*
 * The one mutation behind both a drag and a split shortcut: a view lands in a cell's zone. A view that
 * was already on screen moves rather than appearing twice, and a drop on the middle swaps with the
 * view that stood there instead of closing it, so nothing falls off the grid by accident. A view that
 * fills its cell alone takes the whole cell along (`moveCell`); one of several tabs leaves only its tab.
 */
export function dropView(layout: SplitLayout, viewId: string, at: CellAt, zone: SplitZone): SplitLayout {
    if (!canSplit(layout, at, zone, viewId)) {
        return layout;
    }
    const source = locateView(layout, viewId);
    if (source !== null && fillsCellAlone(layout, source)) {
        return moveCell(layout, source, at, zone);
    }
    if (zone === 'center') {
        // A view that stands nowhere yet joins a host rather than replacing its active tab, so no loose tab vanishes by accident.
        if (source === null && isTabHost(cellAt(layout, at)!)) {
            return dropAsTab(layout, viewId, at, null);
        }
        return tradeInto(layout, viewId, at);
    }
    const sourceCell = source === null ? null : cellAt(layout, source)!;
    const columns = sourceCell === null ? layout.columns : replaceCell(layout.columns, source!, withoutTab(sourceCell, viewId));
    return splitAt(columns, at, zone, { viewId });
}

/* The middle of a cell: a tab trades places with the target's active view, a view that stood nowhere takes that view's place. */
function tradeInto(layout: SplitLayout, viewId: string, at: CellAt): SplitLayout {
    const source = locateView(layout, viewId);
    const sourceCell = source === null ? null : cellAt(layout, source)!;
    const replaced = cellAt(layout, at)!;
    const swapped = sourceCell === null ? layout.columns : replaceCell(layout.columns, source!, renamedIn(sourceCell, viewId, replaced.viewId));
    return settled(replaceCell(swapped, at, renamedIn(replaced, replaced.viewId, viewId)), at);
}

/*
 * A whole cell lands in the zone of another, tabs and all: the middle swaps the two cells, an edge
 * splits. This is the drag of a host by the empty part of its strip, and of a plain cell by its bar.
 */
export function moveCell(layout: SplitLayout, from: CellAt, at: CellAt, zone: SplitZone): SplitLayout {
    const moving = cellAt(layout, from);
    if (moving === null || !canPlace(layout, at, zone, from, true)) {
        return layout;
    }
    if (zone === 'center') {
        const replaced = cellAt(layout, at)!;
        const columns = replaceCell(replaceCell(layout.columns, at, { ...contentOf(moving), size: replaced.size }), from, {
            ...contentOf(replaced),
            size: moving.size
        });
        return settled(columns, at);
    }
    const { columns, target } = withoutCell(layout.columns, from, at);
    return splitAt(columns, target, zone, contentOf(moving));
}

/* Whether `viewId` may join the cell at `at` as a tab; not on the cell it already fills alone, where it would be nothing. */
export function canDropAsTab(layout: SplitLayout, at: CellAt, viewId: string): boolean {
    if (cellAt(layout, at) === null) {
        return false;
    }
    const source = locateView(layout, viewId);
    return !(source !== null && isSameCell(source, at) && fillsCellAlone(layout, source));
}

/*
 * A view joins the cell at `at` as a tab, becomes its active one and the cell takes the focus. `index`
 * is the position among the resulting tabs; null puts it right of the active tab (a reorder in the
 * same host with null leaves the view where it is). A plain target becomes a host. A view that came
 * from another cell leaves it: the cell goes when this was its only view, otherwise only the tab.
 */
export function dropAsTab(layout: SplitLayout, viewId: string, at: CellAt, index: number | null): SplitLayout {
    if (!canDropAsTab(layout, at, viewId)) {
        return layout;
    }
    const target = cellAt(layout, at)!;
    const source = locateView(layout, viewId);
    const sameCell = source !== null && isSameCell(source, at);
    const others = cellViewIds(target).filter((id) => id !== viewId);
    let position = others.length;
    if (index !== null) {
        position = Math.min(Math.max(index, 0), others.length);
    } else if (sameCell) {
        position = cellViewIds(target).indexOf(viewId);
    } else if (others.includes(target.viewId)) {
        position = others.indexOf(target.viewId) + 1;
    }
    const joined = { ...target, viewId, tabs: [...others.slice(0, position), viewId, ...others.slice(position)] };
    const columns = replaceCell(layout.columns, at, joined);
    if (source === null || sameCell) {
        return settled(columns, at);
    }
    if (fillsCellAlone(layout, source)) {
        const removed = withoutCell(columns, source, at);
        return settled(removed.columns, removed.target);
    }
    return settled(replaceCell(columns, source, withoutTab(cellAt(layout, source)!, viewId)), at);
}

/* The view's cell gets the focus and the view becomes its active tab. */
export function activateTab(layout: SplitLayout, viewId: string): SplitLayout {
    const at = locateView(layout, viewId);
    if (at === null) {
        return layout;
    }
    const cell = cellAt(layout, at)!;
    return { columns: cell.viewId === viewId ? layout.columns : replaceCell(layout.columns, at, { ...cell, viewId }), focus: at };
}

/*
 * Takes a view out of its cell. A cell that held only this view closes (null when it was the last
 * cell); a host hands the active tab to the right neighbor, else the left one. The document
 * collapses a remaining single-tab host once it knows what kind of view it holds.
 */
export function closeTab(layout: SplitLayout, viewId: string): SplitLayout | null {
    const at = locateView(layout, viewId);
    if (at === null) {
        return layout;
    }
    const cell = cellAt(layout, at)!;
    if (fillsCellAlone(layout, at)) {
        return closeCell(layout, at);
    }
    return { ...layout, columns: replaceCell(layout.columns, at, withoutTab(cell, viewId)) };
}

/* One step along the strip of the host, stopping at the ends. */
export function moveTabBy(layout: SplitLayout, viewId: string, delta: number): SplitLayout {
    const at = locateView(layout, viewId);
    const cell = at === null ? null : cellAt(layout, at);
    if (at === null || cell === null || cell.tabs === undefined) {
        return layout;
    }
    const index = cell.tabs.indexOf(viewId);
    const next = Math.min(Math.max(index + delta, 0), cell.tabs.length - 1);
    if (next === index) {
        return layout;
    }
    const tabs = cell.tabs.filter((id) => id !== viewId);
    tabs.splice(next, 0, viewId);
    return { ...layout, columns: replaceCell(layout.columns, at, { ...cell, tabs }) };
}

/* A host with exactly one tab becomes a plain cell again; anything else is left alone. */
export function ungroup(layout: SplitLayout, at: CellAt): SplitLayout {
    const cell = cellAt(layout, at);
    if (cell === null || cell.tabs === undefined || cell.tabs.length !== 1) {
        return layout;
    }
    return { ...layout, columns: replaceCell(layout.columns, at, { viewId: cell.tabs[0], size: cell.size }) };
}

/* Loose views have no sidebar entry to return to, so they keep their tab and its close button. */
export function collapseTabHosts(layout: SplitLayout | null, views: readonly ProjectView[]): SplitLayout | null {
    if (layout === null) {
        return null;
    }
    let changed = false;
    const columns = layout.columns.map((column) => {
        const cells = column.cells.map((cell) => {
            if (cell.tabs?.length !== 1) {
                return cell;
            }
            const view = views.find((view) => view.id === cell.viewId);
            if (view === undefined || view.kind === 'file' || view.kind === 'database') {
                return cell;
            }
            changed = true;
            return { viewId: cell.viewId, size: cell.size };
        });
        return cells.every((cell, index) => cell === column.cells[index]) ? column : { ...column, cells };
    });
    return changed ? { ...layout, columns } : layout;
}

/* A view that got another id (a file that moved) keeps its place wherever it stands. */
export function replaceViewId(layout: SplitLayout, from: string, to: string): SplitLayout {
    const at = locateView(layout, from);
    return at === null ? layout : { ...layout, columns: replaceCell(layout.columns, at, renamedIn(cellAt(layout, at)!, from, to)) };
}

/* What showing a view did, which is everything the way back needs. */
export interface ShownView {
    layout: SplitLayout;
    /* The cell the view is standing in now. */
    at: CellAt;
    /* The view that made room for it, null when the view was already on screen or came in as a tab. */
    replaced: string | null;
    /* The cell the person was working in, which is where the focus goes back to. */
    from: CellAt;
    /* Set when the view came in as a tab: what taking it out again needs to know. */
    tab?: {
        viewId: string;
        /* The tab that was active before, which the cell goes back to. */
        activeBefore: string;
        /* The cell was a plain one that became a host for this tab. */
        wasPlain: boolean;
    };
}

export interface ShowOptions {
    /* A view without a row in the sidebar: it goes to a tab host rather than over a view. */
    loose?: boolean;
    /* The view whose host a loose view prefers, when that view stands in one. */
    host?: string | null;
    /* Open beside the view in the focused cell instead of over it. */
    newTab?: boolean;
}

/* The host holding `preferred`, else the first host in reading order: columns left to right, cells top to bottom. */
export function hostFor(layout: SplitLayout, preferred: string | null): CellAt | null {
    if (preferred !== null) {
        const at = locateView(layout, preferred);
        if (at !== null && isTabHost(cellAt(layout, at)!)) {
            return at;
        }
    }
    for (let column = 0; column < layout.columns.length; column += 1) {
        const cell = layout.columns[column].cells.findIndex(isTabHost);
        if (cell !== -1) {
            return { column, cell };
        }
    }
    return null;
}

function shownAsTab(layout: SplitLayout, viewId: string, at: CellAt): ShownView {
    const cell = cellAt(layout, at)!;
    return {
        layout: dropAsTab(layout, viewId, at, null),
        at,
        replaced: null,
        from: layout.focus,
        tab: { viewId, activeBefore: cell.viewId, wasPlain: !isTabHost(cell) }
    };
}

/*
 * A view someone else asked for, put on screen. The first rule that fits wins:
 * 1. It is placed already: its cell takes the focus and it becomes the active tab. Null when it is
 *    the view being looked at, since then there is nothing to do and nothing to undo.
 * 2. The focused cell is a tab host: a new tab right of the active one.
 * 3. `newTab`: the focused cell becomes a host of its view and the new one.
 * 4. `loose` with a host on screen: a tab in the host of `host`, else the first host.
 * 5. `loose` without one: the focused cell becomes a host of this view alone.
 * 6. It replaces the view in the focused cell.
 */
export function showViewIn(layout: SplitLayout, viewId: string, options: ShowOptions = {}): ShownView | null {
    const standing = locateView(layout, viewId);
    if (standing !== null) {
        if (isSameCell(standing, layout.focus) && cellAt(layout, standing)!.viewId === viewId) {
            return null;
        }
        return { layout: activateTab(layout, viewId), at: standing, replaced: null, from: layout.focus };
    }
    const at = layout.focus;
    const focused = cellAt(layout, at);
    if (focused !== null && (isTabHost(focused) || options.newTab)) {
        return shownAsTab(layout, viewId, at);
    }
    if (options.loose) {
        const host = hostFor(layout, options.host ?? null);
        if (host !== null) {
            return shownAsTab(layout, viewId, host);
        }
        if (focused !== null) {
            const replacement = { viewId, tabs: [viewId], size: focused.size };
            return { layout: settled(replaceCell(layout.columns, at, replacement), at), at, replaced: focused.viewId, from: at };
        }
    }
    return { layout: dropView(layout, viewId, at, 'center'), at, replaced: focused?.viewId ?? null, from: at };
}

/* Takes the shown tab out again, and turns a cell that became a host for it back into a plain one. */
function withoutShownTab(layout: SplitLayout, shown: Omit<ShownView, 'layout'>, tab: NonNullable<ShownView['tab']>): SplitLayout {
    const cell = cellAt(layout, shown.at);
    if (cell === null || cell.tabs === undefined || cell.tabs.length === 1 || !cell.tabs.includes(tab.viewId)) {
        return layout;
    }
    let next = withoutTab(cell, tab.viewId);
    if (cell.viewId === tab.viewId && next.tabs?.includes(tab.activeBefore)) {
        next = { ...next, viewId: tab.activeBefore };
    }
    const back = { ...layout, columns: replaceCell(layout.columns, shown.at, next) };
    return tab.wasPlain ? ungroup(back, shown.at) : back;
}

/* Puts the replaced view back as a plain cell, unless the person has grown the cell into several tabs since. */
function withReplacedBack(layout: SplitLayout, shown: Omit<ShownView, 'layout'>): SplitLayout {
    const cell = cellAt(layout, shown.at);
    if (shown.replaced === null || cell === null || cellViewIds(cell).length > 1) {
        return layout;
    }
    return ungroup(tradeInto(layout, shown.replaced, shown.at), shown.at);
}

/*
 * The way back the toast offers. It runs against the layout as it stands when the button is pressed,
 * so a cell a person split or closed since stays that way. A cell that is gone leaves everything where it is.
 */
export function undoShowView(layout: SplitLayout, shown: Omit<ShownView, 'layout'>): SplitLayout {
    const back = shown.tab === undefined ? withReplacedBack(layout, shown) : withoutShownTab(layout, shown, shown.tab);
    return focusCell(back, shown.from);
}

/* Null when that was the last cell; the caller decides what an empty grid means. */
export function closeCell(layout: SplitLayout, at: CellAt): SplitLayout | null {
    if (cellAt(layout, at) === null) {
        return layout;
    }
    if (cellCount(layout) === 1) {
        return null;
    }
    const { columns, target } = withoutCell(layout.columns, at, layout.focus);
    return settled(columns, target);
}

/* Every cell but the one at `at`, which then fills the grid and has the focus. */
export function closeOtherCells(layout: SplitLayout, at: CellAt): SplitLayout {
    const kept = cellAt(layout, at);
    if (kept === null || cellCount(layout) === 1) {
        return layout;
    }
    return { columns: [{ size: 1, cells: [{ ...kept, size: 1 }] }], focus: { column: 0, cell: 0 } };
}

/* The cells in the columns right of the one `at` stands in, which is what "close to the right" closes. */
export function cellsRightOf(layout: SplitLayout, at: CellAt): number {
    return layout.columns.slice(at.column + 1).reduce((total, column) => total + column.cells.length, 0);
}

/* The columns left keep their proportions. A focus that was in a closed column comes to this cell. */
export function closeCellsRightOf(layout: SplitLayout, at: CellAt): SplitLayout {
    if (cellAt(layout, at) === null || cellsRightOf(layout, at) === 0) {
        return layout;
    }
    return settled(layout.columns.slice(0, at.column + 1), layout.focus.column > at.column ? at : layout.focus);
}

export function focusCell(layout: SplitLayout, at: CellAt): SplitLayout {
    return cellAt(layout, at) === null ? layout : { ...layout, focus: at };
}

/* The span a cell covers on its column's axis, in shares, which is what makes two columns comparable. */
function spanOf(cells: readonly SplitCell[], index: number): { start: number; end: number } {
    let start = 0;
    for (let cell = 0; cell < index; cell += 1) {
        start += cells[cell].size;
    }
    return { start, end: start + cells[index].size };
}

/* The neighbor lying most beside the span you left, the topmost one when two lie equally beside it. */
function cellAcross(cells: readonly SplitCell[], span: { start: number; end: number }): number {
    let best = 0;
    let most = -1;
    let start = 0;
    for (let cell = 0; cell < cells.length; cell += 1) {
        const end = start + cells[cell].size;
        const overlap = Math.min(end, span.end) - Math.max(start, span.start);
        if (overlap > most) {
            most = overlap;
            best = cell;
        }
        start = end;
    }
    return best;
}

/*
 * The focus one step in a direction, or the layout untouched at the edge of the grid. Sideways it
 * meets the neighboring column where the cell it left was standing, because two columns divide
 * themselves and an index would jump past a cell that is right there.
 */
export function focusDirection(layout: SplitLayout, direction: SplitDirection): SplitLayout {
    if (cellAt(layout, layout.focus) === null) {
        return layout;
    }
    if (isColumnZone(direction)) {
        const column = direction === 'left' ? layout.focus.column - 1 : layout.focus.column + 1;
        if (column < 0 || column >= layout.columns.length) {
            return layout;
        }
        const span = spanOf(layout.columns[layout.focus.column].cells, layout.focus.cell);
        return focusCell(layout, { column, cell: cellAcross(layout.columns[column].cells, span) });
    }
    const cell = direction === 'up' ? layout.focus.cell - 1 : layout.focus.cell + 1;
    return cell < 0 || cell >= layout.columns[layout.focus.column].cells.length ? layout : focusCell(layout, { column: layout.focus.column, cell });
}

/*
 * A layout can name a view that another client deleted, hold the same view twice after a bad merge,
 * or come from a file written when the limits were wider. Everything the model cannot mean is cut
 * here on the way in, and a layout with nothing left falls back to the first view there is.
 * `extraIds` stand in cells without being project views (loose views), which the caller knows.
 */
export function cleanLayout(layout: SplitLayout, viewIds: readonly string[], extraIds: readonly string[] = []): SplitLayout | null {
    const known = new Set([...viewIds, ...extraIds]);
    const seen = new Set<string>();
    const columns: SplitColumn[] = [];
    for (const column of layout.columns) {
        const cells: SplitCell[] = [];
        for (const cell of column.cells) {
            const listed = cell.tabs !== undefined && cell.tabs.length > 0 ? cell.tabs : null;
            const kept = [...new Set(listed ?? [cell.viewId])].filter((id) => known.has(id) && !seen.has(id));
            if (kept.length === 0 || cells.length === MAX_CELLS) {
                continue;
            }
            kept.forEach((id) => seen.add(id));
            if (listed === null) {
                cells.push(cell.tabs === undefined ? cell : { viewId: cell.viewId, size: cell.size });
            } else {
                cells.push({ ...cell, viewId: kept.includes(cell.viewId) ? cell.viewId : kept[0], tabs: kept });
            }
        }
        if (cells.length > 0 && columns.length < MAX_COLUMNS) {
            columns.push({ ...column, cells });
        }
    }
    if (columns.length === 0) {
        return viewIds.length === 0 ? null : singleLayout(viewIds[0]);
    }
    return settled(columns, layout.focus);
}

/*
 * The view a split puts in the cell it makes. The first one that is not standing anywhere yet, from
 * the focused view down the list and around. A view lives in at most one cell, so with every view
 * already up there is nothing to put beside them and the split does not happen.
 */
export function freeViewFor(state: { views: readonly ProjectView[]; layout: SplitLayout | null; activeViewId: string | null }): string | null {
    const openable = state.views.filter(isOpenableView);
    const taken = new Set(state.layout === null ? [] : viewIdsIn(state.layout));
    const from = openable.findIndex((view) => view.id === state.activeViewId);
    for (let step = 1; step <= openable.length; step += 1) {
        const view = openable[(Math.max(from, 0) + step) % openable.length]!;
        if (!taken.has(view.id)) {
            return view.id;
        }
    }
    return null;
}

/* The ids a layout may point at, in the order the sidebar lists them, so the fallback is the top view. */
export function openableViewIds(views: readonly ProjectView[]): string[] {
    return views.filter(isOpenableView).map((view) => view.id);
}

/* Legacy clients omitted the layout for a single view; only an explicit emptyLayout closes every view. */
export function layoutOf(
    local: Pick<ProjectLocal, 'activeViewId' | 'layout' | 'emptyLayout'>,
    views: readonly ProjectView[],
    extraIds: readonly string[] = []
): SplitLayout | null {
    if (local.emptyLayout === true) {
        return null;
    }
    const ids = openableViewIds(views);
    if (local.layout) {
        return cleanLayout(local.layout, ids, extraIds);
    }
    if (local.activeViewId !== null && ids.includes(local.activeViewId)) {
        return singleLayout(local.activeViewId);
    }
    return ids.length === 0 ? null : singleLayout(ids[0]);
}

/* How close, in pixels, a splitter has to come to the middle of its two neighbors to land on it. */
export const EVEN_SNAP_PX = 8;

/*
 * Nobody hits an even split to the pixel, so the middle pulls a dragged splitter in when it comes close.
 * Measured in pixels rather than shares, so the pull feels the same in a cell of any size.
 */
export function snapToEven(before: number, total: number, span: number, threshold = EVEN_SNAP_PX): number {
    const middle = total / 2;
    return Math.abs(before - middle) * span <= threshold ? middle : before;
}

/* The smallest share a drag leaves a column or cell, of the span the drag moves. */
export const MIN_SHARE = 0.15;

/*
 * The sizes on an axis after the splitter in front of item `at` moved by `moved`, a share of the
 * axis. Only its two neighbors change, unless `mirrored` (Option held) and the axis has a splitter
 * mirroring this one: that one moves the other way, so the items between them grow or shrink from
 * both sides and the outer two change alike. Two items have no mirror and drag as usual. `span` is
 * the pixels one unit of size covers, for the pull to an even split.
 */
export function draggedSizes(sizes: readonly number[], at: number, moved: number, span: number, mirrored: boolean): number[] {
    if (at <= 0 || at >= sizes.length) {
        return [...sizes];
    }
    const mirror = sizes.length - at;
    if (mirrored && Math.abs(mirror - at) === 1) {
        const inner = Math.min(at, mirror);
        const total = sizes[inner - 1] + sizes[inner] + sizes[inner + 1];
        const floor = MIN_SHARE * total;
        // What each outer item gains; the far splitter dragged towards the middle is the same gain.
        const wanted = at === inner ? moved : -moved;
        const grow = Math.max(floor - Math.min(sizes[inner - 1], sizes[inner + 1]), Math.min((sizes[inner] - floor) / 2, wanted));
        return sizes.map((size, index) => (index === inner ? size - 2 * grow : Math.abs(index - inner) === 1 ? size + grow : size));
    }
    const before = sizes[at - 1];
    const total = before + sizes[at];
    const next = snapToEven(Math.max(MIN_SHARE * total, Math.min(total - MIN_SHARE * total, before + moved)), total, span);
    return sizes.map((size, index) => (index === at - 1 ? next : index === at ? total - next : size));
}

/*
 * Even shares for the two neighbors of the splitter in front of `at`, which split the span they
 * already hold between them so the rest of the axis stays put; with `all`, for every item on it.
 */
function evenOut<T extends { size: number }>(items: readonly T[], at: number, all: boolean): T[] {
    if (at <= 0 || at >= items.length) {
        return [...items];
    }
    if (all) {
        return items.map((item) => ({ ...item, size: 1 / items.length }));
    }
    const half = (items[at - 1].size + items[at].size) / 2;
    return items.map((item, index) => (index === at - 1 || index === at ? { ...item, size: half } : item));
}

/* A double click on the splitter in front of column `at`. */
export function evenColumns(layout: SplitLayout, at: number, all: boolean): SplitLayout {
    return { ...layout, columns: evenOut(layout.columns, at, all) };
}

/* A double click on the splitter in front of cell `at` of a column; `all` stays inside that column. */
export function evenCells(layout: SplitLayout, column: number, at: number, all: boolean): SplitLayout {
    if (layout.columns[column] === undefined) {
        return layout;
    }
    return {
        ...layout,
        columns: layout.columns.map((candidate, index) => (index === column ? { ...candidate, cells: evenOut(candidate.cells, at, all) } : candidate))
    };
}

/*
 * The cell a maximized view stands in, or null when there is nothing to fill: no view maximized,
 * one that left the grid, or a grid of one cell, which fills the area already.
 */
export function maximizedCell(layout: SplitLayout | null, viewId: string | null): CellAt | null {
    if (layout === null || viewId === null || cellCount(layout) < 2) {
        return null;
    }
    return locateView(layout, viewId);
}
