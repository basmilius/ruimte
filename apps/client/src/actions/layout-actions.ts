import { ActionRefusal, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import { isCanvasView, isOpenableView, type ProjectNode } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { kindOf, kindOfNode, unknownView } from '@/actions/action-reach';
import { projectPathOf } from '@/actions/files-actions';
import { canDropAsTab, canSplit, cellAt, cellViewIds, focusedViewId, freeViewFor, isSameCell, locateView } from '@/layout/split';
import { positionAfterLifting } from '@/layout/tab-drop';
import { sightOf, visibleNodes } from '@/state/attention';
import { focusedCanvas } from '@/state/canvas';
import { closeCellGuarded } from '@/state/cell-close';
import { activeViewOf, cellViewOf, type DocumentState } from '@/state/document';
import { openTab, useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { looseTabLabel } from '@/surface/panels/tab-label';

/* What stands in a cell: a view of the project, or a loose view of this client, which the document does not have. */
function cellName(state: DocumentState, viewId: string): string {
    const loose = useFiles.getState().tabs.find((tab) => tab.key === viewId);
    return cellViewOf(state, viewId)?.name ?? (loose === undefined ? viewId : looseTabLabel(loose));
}

/* The cells of the grid column by column, each named by the view standing in it. */
function cellsOf(state: DocumentState): ActionOutput<'workspace.inspect'>['cells'] {
    const layout = state.layout;
    if (layout === null) {
        return [];
    }
    return layout.columns.flatMap((column, columnIndex) =>
        column.cells.map((cell, cellIndex) => ({
            viewId: cell.viewId,
            view: cellName(state, cell.viewId),
            column: columnIndex,
            cell: cellIndex,
            focused: isSameCell(layout.focus, { column: columnIndex, cell: cellIndex })
        }))
    );
}

/* The grid of cells the views stand in, and what the workspace has on screen. */
export function layoutActions(document: StoreApi<DocumentState>): ActionHandlers<void> {
    return {
        'workspace.inspect': () => {
            const state = document.getState();
            const active = activeViewOf(state);
            const current = active && isCanvasView(active) ? focusedCanvas().getState() : null;
            const inSight = current === null ? new Set<string>() : new Set(visibleNodes(sightOf(current), { readable: false }));
            return {
                output: {
                    project: useProject.getState().current?.name ?? 'Untitled project',
                    revision: useProject.getState().rev,
                    activeView: active
                        ? {
                              id: active.id,
                              name: active.name ?? active.id,
                              kind: kindOf(active)
                          }
                        : null,
                    views: state.views.filter(isOpenableView).map((view) => ({
                        id: view.id,
                        name: view.name ?? view.id,
                        kind: kindOf(view)
                    })),
                    cells: cellsOf(state),
                    canvas:
                        active && current
                            ? {
                                  viewId: active.id,
                                  nodes: current.order
                                      .map((id) => current.nodes[id]!)
                                      .map((node) => ({
                                          id: node.id,
                                          title: node.title,
                                          kind: kindOfNode(node),
                                          visible: inSight.has(node.id)
                                      })),
                                  selected: current.selection
                                      .map((id) => current.nodes[id])
                                      .filter((node): node is ProjectNode => node !== undefined)
                                      .map((node) => ({
                                          id: node.id,
                                          title: node.title,
                                          kind: kindOfNode(node)
                                      }))
                              }
                            : null
                }
            };
        },
        'split.create': ({ direction, viewId }) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open to split.');
            }
            const target = viewId ?? freeViewFor(state);
            if (target === null) {
                throw new ActionRefusal('no-free-view', 'Every view is already on screen, so there is none to put beside them.');
            }
            const view = state.views.find((candidate) => candidate.id === target);
            if (!view || !isOpenableView(view)) {
                throw unknownView(target);
            }
            if (!canSplit(layout, layout.focus, direction, target)) {
                throw new ActionRefusal('no-room', `There is no room for another cell ${direction === 'right' ? 'to the right' : 'below'}.`);
            }
            state.splitFocused(direction, target);
            return { output: { viewId: target, view: view.name ?? target, direction } };
        },
        'split.close': async ({ viewId }) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            const at = viewId === null ? layout.focus : locateView(layout, viewId);
            const closing = at === null ? null : cellAt(layout, at);
            if (at === null || closing === null) {
                throw new ActionRefusal('view-not-shown', `“${cellName(state, viewId ?? '')}” does not stand in a cell.`);
            }
            // Named first: a loose view is gone from the pool once its cell is.
            const view = cellName(state, closing.viewId);
            if (!(await closeCellGuarded(at))) {
                throw new ActionRefusal('close-kept', `“${view}” was kept open: a person chose to keep its unsaved changes.`);
            }
            return { output: { viewId: closing.viewId, view } };
        },
        'split.focus': ({ direction }) => {
            const state = document.getState();
            if (state.layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            const before = state.layout.focus;
            state.focusTowards(direction);
            const after = document.getState().layout ?? state.layout;
            const viewId = focusedViewId(after);
            if (viewId === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            return { output: { viewId, view: cellName(state, viewId), changed: !isSameCell(before, after.focus) } };
        },
        'split.placeView': ({ viewId, paths, cellViewId, zone, tabGap }, call) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            if ((viewId === null) === (paths === null)) {
                throw new ActionRefusal('view-or-files', 'Name a view or files, one of the two.');
            }
            const at = cellViewId === null ? layout.focus : locateView(layout, cellViewId);
            const standing = at === null ? null : cellAt(layout, at);
            if (at === null || standing === null) {
                throw new ActionRefusal('view-not-shown', `“${cellName(state, cellViewId ?? '')}” does not stand in a cell.`);
            }
            if (viewId !== null) {
                const view = cellViewOf(state, viewId);
                // A loose view is nobody's to name from outside the grid, so it counts only while it stands in a cell.
                if (view === null ? locateView(layout, viewId) === null : !isOpenableView(view)) {
                    throw unknownView(viewId);
                }
            }
            const folder = useProject.getState().current?.folder ?? null;
            // Validate every path before changing the grid. A loose view names its file the way the daemon does.
            const absolute = (paths ?? []).map((path) => projectPathOf(folder, path, call.actor.kind));
            const asTab = zone === 'center' && tabGap !== undefined;
            if (asTab ? viewId !== null && !canDropAsTab(layout, at, viewId) : !canSplit(layout, at, zone, viewId)) {
                throw new ActionRefusal('no-room', 'The grid has no room there, or the view already stands in that cell.');
            }
            const created: string[] = [];
            let fileAt = at;
            let gap = tabGap ?? null;
            for (const path of absolute) {
                const files = useFiles.getState();
                const cell = cellAt(document.getState().layout!, fileAt)!;
                const index = gap === null || cell.tabs === undefined ? null : positionAfterLifting(cell.tabs, gap, path);
                const id = asTab
                    ? files.dropTab(openTab(files, path), useSettings.getState().filesTabLimit, fileAt, 'center', index)
                        ? path
                        : null
                    : files.dropFile(path, useSettings.getState().filesTabLimit, fileAt, created.length > 0 && zone === 'center' ? 'down' : zone);
                if (id === null) {
                    break;
                }
                created.push(id);
                fileAt = locateView(document.getState().layout!, id)!;
                gap = cellViewIds(cellAt(document.getState().layout!, fileAt)!).indexOf(id) + 1;
            }
            const target = viewId ?? created[0] ?? standing.viewId;
            if (viewId !== null) {
                if (asTab) {
                    const index = tabGap == null || standing.tabs === undefined ? null : positionAfterLifting(standing.tabs, tabGap, viewId);
                    document.getState().dropViewAsTab(target, at, index);
                } else {
                    document.getState().dropViewAt(target, at, zone);
                }
            }
            return { output: { viewId: target, view: cellName(document.getState(), target), cellViewId: standing.viewId, zone, created } };
        }
    };
}
