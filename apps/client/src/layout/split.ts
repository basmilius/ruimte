import { updateSplitLayout, type SplitCommand, type SplitLayout as SplitTree, type SplitNode, type SplitPane, type SplitSide } from '@adecore/ui';
import { isOpenableView, type ProjectLocal, type ProjectView, type SplitCell, type SplitColumn, type SplitLayout } from '@ruimte/contracts';

/* Columns of cells instead of a free tree, so "at most three by three" is these two numbers and every layout the model can express is allowed. */
const MAX_COLUMNS = 3;
const MAX_CELLS = 3;

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

function replaceCell(columns: readonly SplitColumn[], at: CellAt, next: SplitCell): SplitColumn[] {
    return columns.map((column, columnIndex) =>
        columnIndex === at.column ? { ...column, cells: column.cells.map((cell, cellIndex) => (cellIndex === at.cell ? next : cell)) } : column
    );
}

function fillsCellAlone(layout: SplitLayout, source: CellAt): boolean {
    return cellViewIds(cellAt(layout, source)!).length === 1;
}

const COLUMNS_ID = 'split:columns';
const NEW_PANE_ID = 'split:new-pane';
const NEW_SPLIT_ID = 'split:new-split';

/* Stands in for a view that is in no layout, to ask what a drop of any view would do. */
const ANY_VIEW = 'split:any-view';

const SIDES: Record<SplitDirection, SplitSide> = { left: 'left', right: 'right', up: 'top', down: 'bottom' };

/* A view stands in one cell, so a view names its cell; the stored format has no ids of its own and older clients read it. */
function paneIdOf(cell: SplitCell): string {
    return cellViewIds(cell)[0]!;
}

function columnIdOf(column: SplitColumn): string {
    const first = paneIdOf(column.cells[0]!);
    return column.cells.length === 1 ? first : `split:rows:${first}`;
}

function focusedPaneId(layout: SplitLayout): string {
    return paneIdOf(cellAt(layout, clampFocus(layout.columns, layout.focus))!);
}

/* The saved columns of cells as ADE CORE's split tree. `maximized` is a view, which only drawing the grid needs. */
export function splitTree(layout: SplitLayout, maximized: string | null = null): SplitTree {
    const stacks = layout.columns.map((column): SplitNode => {
        const panes = column.cells.map((cell): SplitPane => ({ type: 'pane', id: paneIdOf(cell), views: cellViewIds(cell), active: cell.viewId }));
        if (panes.length === 1) {
            return panes[0]!;
        }
        return { type: 'split', id: columnIdOf(column), axis: 'vertical', children: panes, sizes: column.cells.map((cell) => cell.size) };
    });
    const sizes = layout.columns.map((column) => column.size);
    const root: SplitNode = stacks.length === 1 ? stacks[0]! : { type: 'split', id: COLUMNS_ID, axis: 'horizontal', children: stacks, sizes };
    const filling = maximizedCell(layout, maximized);
    return { root, focused: focusedPaneId(layout), maximized: filling === null ? null : paneIdOf(cellAt(layout, filling)!) };
}

/* The panes of one column, or null for a node that holds anything but a stack of panes. */
function panesOf(node: SplitNode): SplitPane[] | null {
    if (node.type === 'pane') {
        return [node];
    }
    return node.axis === 'vertical' && node.children.every((child) => child.type === 'pane') ? (node.children as SplitPane[]) : null;
}

/*
 * The tree back in the saved form, or null for one that form cannot hold: a split nested deeper than
 * columns of cells, or past the limits. A pane that was a host stays one with a single tab left, which
 * the tree does not tell from a plain cell.
 */
function storedForm(tree: SplitTree, before: SplitLayout): SplitLayout | null {
    const { root } = tree;
    const sideBySide = root.type === 'split' && root.axis === 'horizontal';
    const stacks = sideBySide ? root.children : [root];
    if (stacks.length > MAX_COLUMNS) {
        return null;
    }
    const hosts = new Set(before.columns.flatMap((column) => column.cells.filter(isTabHost).map(paneIdOf)));
    const columns: SplitColumn[] = [];
    let focus: CellAt = { column: 0, cell: 0 };
    for (const [column, stack] of stacks.entries()) {
        const panes = panesOf(stack);
        if (panes === null || panes.length > MAX_CELLS || panes.some((pane) => pane.active === null)) {
            return null;
        }
        const cells = panes.map((pane, cell): SplitCell => {
            const size = stack.type === 'split' ? stack.sizes[cell]! : 1;
            if (pane.id === tree.focused) {
                focus = { column, cell };
            }
            return pane.views.length > 1 || hosts.has(pane.id) ? { viewId: pane.active!, tabs: pane.views, size } : { viewId: pane.active!, size };
        });
        columns.push({ size: sideBySide ? root.sizes[column]! : 1, cells });
    }
    return { columns, focus };
}

/* Refused, the layout stands as it was: the same object, so a caller can tell. */
export function runSplitCommands(layout: SplitLayout, commands: readonly SplitCommand[]): SplitLayout {
    const tree = splitTree(layout);
    const next = commands.reduce(updateSplitLayout, tree);
    return next === tree ? layout : (storedForm(next, layout) ?? layout);
}

/* An edge on the side of a column makes a column, so that command names the whole column and never nests a split in it. */
function edgeTargetOf(layout: SplitLayout, at: CellAt, zone: SplitDirection): string {
    return isColumnZone(zone) ? columnIdOf(layout.columns[at.column]!) : paneIdOf(cellAt(layout, at)!);
}

function moveCellCommand(layout: SplitLayout, from: CellAt, at: CellAt, zone: SplitZone): SplitCommand | null {
    const moving = cellAt(layout, from);
    const target = cellAt(layout, at);
    if (moving === null || target === null || isSameCell(from, at)) {
        return null;
    }
    if (zone === 'center') {
        return { type: 'swap', sourceId: paneIdOf(moving), targetId: paneIdOf(target) };
    }
    return { type: 'move', sourceId: paneIdOf(moving), targetId: edgeTargetOf(layout, at, zone), side: SIDES[zone], splitId: NEW_SPLIT_ID };
}

/* The middle of a cell: a tab trades places with the target's active view, a view that stood nowhere takes that view's place. */
function tradeCommands(layout: SplitLayout, viewId: string, at: CellAt): SplitCommand[] {
    const source = locateView(layout, viewId);
    const target = cellAt(layout, at)!;
    const targetId = paneIdOf(target);
    if (source === null) {
        return [
            { type: 'replace', viewId: target.viewId, replacement: viewId },
            { type: 'focus', paneId: targetId }
        ];
    }
    return [{ type: 'swap', sourceId: paneIdOf(cellAt(layout, source)!), targetId, viewId }];
}

function edgeCommand(layout: SplitLayout, viewId: string, source: CellAt | null, at: CellAt, zone: SplitDirection): SplitCommand {
    const targetId = edgeTargetOf(layout, at, zone);
    if (source === null) {
        const newPane: SplitPane = { type: 'pane', id: NEW_PANE_ID, views: [viewId], active: viewId };
        return { type: 'split', targetId, side: SIDES[zone], newPane, splitId: NEW_SPLIT_ID };
    }
    return {
        type: 'move',
        sourceId: paneIdOf(cellAt(layout, source)!),
        targetId,
        viewId,
        side: SIDES[zone],
        newPaneId: NEW_PANE_ID,
        splitId: NEW_SPLIT_ID
    };
}

/* Whether the whole cell at `from` may land in the zone of the cell at `at`, which is what dragging a host by its bar asks. */
export function canMoveCell(layout: SplitLayout, from: CellAt, at: CellAt, zone: SplitZone): boolean {
    return moveCell(layout, from, at, zone) !== layout;
}

/*
 * Whether a drop on this zone would land. A `moving` view that fills its cell alone takes the cell
 * along, so a layout that looks full may have room; a drop on the cell it already sits in is nothing.
 */
export function canSplit(layout: SplitLayout, at: CellAt, zone: SplitZone, moving: string | null = null): boolean {
    return dropView(layout, moving ?? ANY_VIEW, at, zone) !== layout;
}

/*
 * The one mutation behind both a drag and a split shortcut: a view lands in a cell's zone. A view that
 * was already on screen moves rather than appearing twice, and a drop on the middle swaps with the
 * view that stood there instead of closing it, so nothing falls off the grid by accident. A view that
 * fills its cell alone takes the whole cell along (`moveCell`); one of several tabs leaves only its tab,
 * and a drop on the edge of its own host is a split, not nothing.
 */
export function dropView(layout: SplitLayout, viewId: string, at: CellAt, zone: SplitZone): SplitLayout {
    const target = cellAt(layout, at);
    if (target === null) {
        return layout;
    }
    const source = locateView(layout, viewId);
    const alone = source !== null && fillsCellAlone(layout, source);
    if (source !== null && isSameCell(source, at) && (zone === 'center' || alone)) {
        return layout;
    }
    if (alone) {
        return moveCell(layout, source, at, zone);
    }
    if (zone !== 'center') {
        return runSplitCommands(layout, [edgeCommand(layout, viewId, source, at, zone)]);
    }
    // A view that stands nowhere yet joins a host rather than replacing its active tab, so no loose tab vanishes by accident.
    if (source === null && isTabHost(target)) {
        return dropAsTab(layout, viewId, at, null);
    }
    return runSplitCommands(layout, tradeCommands(layout, viewId, at));
}

/*
 * A whole cell lands in the zone of another, tabs and all: the middle swaps the two cells, an edge
 * splits. This is the drag of a host by the empty part of its strip, and of a plain cell by its bar.
 */
export function moveCell(layout: SplitLayout, from: CellAt, at: CellAt, zone: SplitZone): SplitLayout {
    const command = moveCellCommand(layout, from, at, zone);
    return command === null ? layout : runSplitCommands(layout, [command]);
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
    // The tree counts a gap in the tabs as they stand, with the view still among them.
    const gap = sameCell && position >= cellViewIds(target).indexOf(viewId) ? position + 1 : position;
    return runSplitCommands(layout, [{ type: 'insert', paneId: paneIdOf(target), viewId, index: gap }]);
}

export function activateTab(layout: SplitLayout, viewId: string): SplitLayout {
    const at = locateView(layout, viewId);
    return at === null ? layout : runSplitCommands(layout, [{ type: 'activate', paneId: paneIdOf(cellAt(layout, at)!), viewId }]);
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
    return fillsCellAlone(layout, at) ? closeCell(layout, at) : runSplitCommands(layout, [{ type: 'close', viewId }]);
}

/* One step along the strip of the host, stopping at the ends. The tab in front and the focus stay where they are. */
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
    const paneId = paneIdOf(cell);
    return runSplitCommands(layout, [
        { type: 'insert', paneId, viewId, index: next > index ? next + 1 : next },
        { type: 'activate', paneId, viewId: cell.viewId },
        { type: 'focus', paneId: focusedPaneId(layout) }
    ]);
}

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

/* A view that got another id (a file that moved) keeps its place wherever it stands, unless that id stands somewhere already: a view stands in one cell. */
export function replaceViewId(layout: SplitLayout, from: string, to: string): SplitLayout {
    if (from !== to && locateView(layout, to) !== null) {
        return closeTab(layout, from) ?? layout;
    }
    return runSplitCommands(layout, [{ type: 'replace', viewId: from, replacement: to }]);
}

/* What showing a view did, which is everything the way back needs. */
export interface ShownView {
    layout: SplitLayout;
    at: CellAt;
    /* The view that made room for it, null when the view was already on screen or came in as a tab. */
    replaced: string | null;
    /* The cell the person was working in, where the focus goes back to. */
    from: CellAt;
    /* Set when the view came in as a tab. */
    tab?: {
        viewId: string;
        activeBefore: string;
        /* The cell was a plain one that became a host for this tab. */
        wasPlain: boolean;
    };
}

interface ShowOptions {
    /* A view without a row in the sidebar: it goes to a tab host rather than over a view. */
    loose?: boolean;
    /* The view whose host a loose view prefers, when that view stands in one. */
    host?: string | null;
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
            const replaced = runSplitCommands(layout, tradeCommands(layout, viewId, at));
            const host = { viewId, tabs: [viewId], size: focused.size };
            return { layout: { ...replaced, columns: replaceCell(replaced.columns, at, host) }, at, replaced: focused.viewId, from: at };
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
    const commands: SplitCommand[] = [{ type: 'close', viewId: tab.viewId }];
    if (cell.viewId === tab.viewId) {
        commands.push({ type: 'activate', paneId: paneIdOf(cell), viewId: tab.activeBefore }, { type: 'focus', paneId: focusedPaneId(layout) });
    }
    const back = runSplitCommands(layout, commands);
    return tab.wasPlain ? ungroup(back, shown.at) : back;
}

/* Puts the replaced view back as a plain cell, unless the person has grown the cell into several tabs since. */
function withReplacedBack(layout: SplitLayout, shown: Omit<ShownView, 'layout'>): SplitLayout {
    const cell = cellAt(layout, shown.at);
    if (shown.replaced === null || cell === null || cellViewIds(cell).length > 1) {
        return layout;
    }
    return ungroup(runSplitCommands(layout, tradeCommands(layout, shown.replaced, shown.at)), shown.at);
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
    const cell = cellAt(layout, at);
    if (cell === null) {
        return layout;
    }
    return cellCount(layout) === 1 ? null : runSplitCommands(layout, [{ type: 'closePane', paneId: paneIdOf(cell) }]);
}

function closingCells(cells: readonly SplitCell[]): SplitCommand[] {
    return cells.map((cell) => ({ type: 'closePane', paneId: paneIdOf(cell) }));
}

export function closeOtherCells(layout: SplitLayout, at: CellAt): SplitLayout {
    const kept = cellAt(layout, at);
    if (kept === null || cellCount(layout) === 1) {
        return layout;
    }
    const others = layout.columns.flatMap((column) => column.cells).filter((cell) => cell !== kept);
    return runSplitCommands(layout, [...closingCells(others), { type: 'focus', paneId: paneIdOf(kept) }]);
}

export function cellsRightOf(layout: SplitLayout, at: CellAt): number {
    return layout.columns.slice(at.column + 1).reduce((total, column) => total + column.cells.length, 0);
}

/* The columns left keep their proportions. A focus that was in a closed column comes to this cell. */
export function closeCellsRightOf(layout: SplitLayout, at: CellAt): SplitLayout {
    const kept = cellAt(layout, at);
    if (kept === null || cellsRightOf(layout, at) === 0) {
        return layout;
    }
    const closing = closingCells(layout.columns.slice(at.column + 1).flatMap((column) => column.cells));
    return runSplitCommands(layout, layout.focus.column > at.column ? [...closing, { type: 'focus', paneId: paneIdOf(kept) }] : closing);
}

export function focusCell(layout: SplitLayout, at: CellAt): SplitLayout {
    const cell = cellAt(layout, at);
    return cell === null ? layout : runSplitCommands(layout, [{ type: 'focus', paneId: paneIdOf(cell) }]);
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

/* The smallest share a drag leaves a column or cell, of the span the drag moves. */
export const MIN_SHARE = 0.15;

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
