import {
    activateTab,
    canDropAsTab,
    canSplit,
    cellAt,
    cellViewIds,
    closeTab,
    dropAsTab,
    dropView,
    focusCell,
    hostFor,
    isTabHost,
    locateView,
    moveTabBy,
    replaceViewId,
    showViewIn,
    ungroup
} from '@/layout/split';
import type { DocumentState } from '@/state/document';
import { canStandInCell, cellViewOf, type DocumentKit } from '@/state/document-model';

/* The tabs of a cell, and the loose views that stand in them without being views of the project. */
export function createDocumentTabsSlice({
    get,
    commit,
    change
}: DocumentKit): Pick<
    DocumentState,
    | 'showLoose'
    | 'dropLooseAt'
    | 'dropLooseAsTab'
    | 'dropViewAsTab'
    | 'moveTab'
    | 'splitTabOff'
    | 'ungroupCell'
    | 'closeLoose'
    | 'closeViewTab'
    | 'replaceViewKey'
    | 'activateTab'
    | 'stepTab'
> {
    return {
        showLoose(key, options) {
            const state = get();
            const layout = state.layout;
            if (layout === null) {
                commit({ columns: [{ size: 1, cells: [{ viewId: key, tabs: [key], size: 1 }] }], focus: { column: 0, cell: 0 } });
                return null;
            }
            const focused = cellAt(layout, layout.focus);
            // A loose view alone in its cell grows tabs rather than being replaced, since nothing would bring it back.
            const grows =
                focused !== null && !isTabHost(focused) && cellViewOf(state, focused.viewId) === null && hostFor(layout, state.lastHostViewId) === null;
            const shown = showViewIn(layout, key, { loose: true, host: state.lastHostViewId, newTab: grows });
            if (shown === null) {
                return null;
            }
            // Quietly the view lands in a host the focus is not in; where it took a cell's place the focus goes with it.
            commit(options?.focus === false && shown.replaced === null ? focusCell(shown.layout, layout.focus) : shown.layout);
            return shown;
        },

        dropLooseAt(key, at, zone) {
            const state = get();
            if (state.layout === null || !canSplit(state.layout, at, zone, key)) {
                return false;
            }
            commit(dropView(state.layout, key, at, zone));
            return true;
        },

        dropLooseAsTab(key, at, index = null) {
            const state = get();
            if (state.layout === null || !canDropAsTab(state.layout, at, key)) {
                return false;
            }
            commit(dropAsTab(state.layout, key, at, index));
            return true;
        },

        dropViewAsTab(viewId, at, index) {
            const state = get();
            if (!canStandInCell(state, viewId)) {
                return false;
            }
            return get().dropLooseAsTab(viewId, at, index);
        },

        moveTab(viewId, delta) {
            change((layout) => moveTabBy(layout, viewId, delta));
        },

        splitTabOff(viewId) {
            const state = get();
            const at = state.layout === null ? null : locateView(state.layout, viewId);
            if (state.layout === null || at === null || !canSplit(state.layout, at, 'right', viewId)) {
                return false;
            }
            commit(dropView(state.layout, viewId, at, 'right'));
            return true;
        },

        ungroupCell(at) {
            change((layout) => ungroup(layout, at));
        },

        closeLoose(key) {
            const state = get();
            if (state.layout === null || locateView(state.layout, key) === null) {
                return;
            }
            commit(closeTab(state.layout, key));
        },

        closeViewTab(viewId) {
            change((layout) => closeTab(layout, viewId));
        },

        replaceViewKey(from, to) {
            const state = get();
            if (state.layout !== null && locateView(state.layout, from) !== null) {
                commit(replaceViewId(state.layout, from, to));
            }
        },

        activateTab(viewId) {
            change((layout) => activateTab(layout, viewId));
        },

        stepTab(delta) {
            const state = get();
            const cell = state.layout === null ? null : cellAt(state.layout, state.layout.focus);
            if (state.layout === null || cell === null || cell.tabs === undefined || cell.tabs.length < 2) {
                return;
            }
            const tabs = cellViewIds(cell);
            const next = tabs[(tabs.indexOf(cell.viewId) + delta + tabs.length) % tabs.length]!;
            commit(activateTab(state.layout, next));
        }
    };
}
