import {
    canMoveCell,
    canSplit,
    cellAt,
    cellCount,
    closeCell,
    closeCellsRightOf,
    closeOtherCells,
    dropView,
    focusCell,
    focusDirection,
    focusedViewId,
    isSameCell,
    moveCell,
    runSplitCommands,
    showViewIn,
    singleLayout,
    undoShowView
} from '@/layout/split';
import type { DocumentState } from '@/state/document';
import { canStandInCell, type DocumentKit } from '@/state/document-model';

/* Which view stands in which cell, which cell has the focus, and how big each is. */
export function createDocumentGridSlice({
    set,
    get,
    commit,
    change
}: DocumentKit): Pick<
    DocumentState,
    | 'setActiveView'
    | 'showView'
    | 'undoShowView'
    | 'dropViewAt'
    | 'moveCellTo'
    | 'splitFocused'
    | 'closeCellAt'
    | 'closeOtherCells'
    | 'closeCellsRightOf'
    | 'focusCellAt'
    | 'toggleMaximized'
    | 'focusTowards'
    | 'runSplitCommand'
    | 'setBodyFocused'
> {
    return {
        setActiveView(id) {
            if (get().activeViewId !== id) {
                get().showView(id);
            }
        },

        showView(id, options) {
            const state = get();
            if (!canStandInCell(state, id)) {
                return null;
            }
            if (state.layout === null) {
                commit(singleLayout(id));
                return null;
            }
            const shown = showViewIn(state.layout, id, options);
            if (shown !== null) {
                commit(shown.layout);
            }
            return shown;
        },

        undoShowView(shown) {
            const state = get();
            if (state.layout !== null) {
                // A loose view that was replaced is closed by now, and a closed tab does not come back with this.
                const back = shown.replaced !== null && !canStandInCell(state, shown.replaced) ? { ...shown, replaced: null } : shown;
                commit(undoShowView(state.layout, back));
            }
        },

        dropViewAt(viewId, at, zone) {
            const state = get();
            if (state.layout === null || !canStandInCell(state, viewId) || !canSplit(state.layout, at, zone, viewId)) {
                return;
            }
            commit(dropView(state.layout, viewId, at, zone));
        },

        moveCellTo(from, at, zone) {
            const state = get();
            if (state.layout !== null && canMoveCell(state.layout, from, at, zone)) {
                commit(moveCell(state.layout, from, at, zone));
            }
        },

        splitFocused(direction, viewId) {
            const state = get();
            if (state.layout !== null) {
                get().dropViewAt(viewId, state.layout.focus, direction);
            }
        },

        closeCellAt(at) {
            change((layout) => closeCell(layout, at));
        },

        closeOtherCells(at) {
            change((layout) => closeOtherCells(layout, at));
        },

        closeCellsRightOf(at) {
            change((layout) => closeCellsRightOf(layout, at));
        },

        focusCellAt(at) {
            const state = get();
            // Asked on every press and every focus inside a cell, so the cell that already has it
            // costs nothing, since a commit writes every editor back.
            if (state.layout !== null && cellAt(state.layout, at) !== null && !isSameCell(state.layout.focus, at)) {
                commit(focusCell(state.layout, at));
            }
        },

        toggleMaximized() {
            const state = get();
            if (state.maximized !== null) {
                set({ maximized: null });
                return;
            }
            if (state.layout !== null && cellCount(state.layout) > 1) {
                set({ maximized: focusedViewId(state.layout) });
            }
        },

        focusTowards(direction) {
            const state = get();
            if (state.layout !== null) {
                commit(focusDirection(state.layout, direction));
            }
        },

        /* A splitter is not a move of the grid, since no editor opens or closes, so it sets the sizes alone. */
        runSplitCommand(command) {
            const { layout } = get();
            const next = layout === null ? null : runSplitCommands(layout, [command]);
            if (layout === null || next === null || next === layout) {
                return;
            }
            if (isSameCell(next.focus, layout.focus)) {
                set({ layout: next });
            } else {
                commit(next);
            }
        },

        setBodyFocused(focused) {
            set({ bodyFocused: focused });
        }
    };
}
