import i18next from 'i18next';
import { closeCellAction, closeCellsRightOfAction, closeOtherCellsAction, closeTabAction, focusCellAction, splitAction } from '@/action-port/person-actions';
import { defineBehaviors, type KeyPress } from '@/commands/behavior';
import { focusedClosableTab, focusedHostTab, onStandaloneView } from '@/commands/key-context';
import { cellAt, canSplit, cellCount, cellsRightOf, focusDirection, isTabHost, maximizedCell, type SplitDirection } from '@/layout/split';
import { stepView, viewStepTarget } from '@/project/views';
import { focusedCanvas, maximizeTargetOf } from '@/state/canvas';
import { useDocument } from '@/state/document';

function hostOf() {
    const { layout } = useDocument.getState();
    const cell = layout === null ? null : cellAt(layout, layout.focus);
    if (layout === null || cell === null || !isTabHost(cell)) {
        return null;
    }
    const tabs = cell.tabs ?? [];

    return { layout, viewId: cell.viewId, tabs, index: tabs.indexOf(cell.viewId) };
}

function takeKey(press: KeyPress, run: () => void): true {
    press.event.preventDefault();
    run();

    return true;
}

function focusing(direction: SplitDirection) {
    return {
        run: () => focusCellAction(direction),
        key(press: KeyPress): boolean {
            const { layout } = useDocument.getState();
            if (layout !== null && focusDirection(layout, direction) !== layout) {
                takeKey(press, () => focusCellAction(direction));
            }

            return true;
        }
    };
}

function steppingView(delta: 1 | -1) {
    return {
        run: () => stepView(delta),
        key(press: KeyPress): boolean {
            if (viewStepTarget(delta) !== null) {
                takeKey(press, () => stepView(delta));
            }

            return true;
        }
    };
}

function steppingTab(delta: 1 | -1) {
    return {
        run: () => useDocument.getState().stepTab(delta),
        offered: () => (hostOf()?.tabs.length ?? 0) > 1,
        /* Stepping between the tabs of the focused host, whatever the host holds: a terminal in it hands the key back so it never reaches the PTY. */
        key: (press: KeyPress) => focusedHostTab() !== null && takeKey(press, () => useDocument.getState().stepTab(delta))
    };
}

function movingTab(delta: 1 | -1) {
    return {
        run: () => {
            const tab = focusedHostTab();
            if (tab !== null) {
                useDocument.getState().moveTab(tab, delta);
            }
        },
        offered: () => {
            const host = hostOf();

            return host !== null && (delta === -1 ? host.index > 0 : host.index < host.tabs.length - 1);
        },
        key: (press: KeyPress) => {
            const tab = focusedHostTab();

            return tab !== null && takeKey(press, () => useDocument.getState().moveTab(tab, delta));
        }
    };
}

export const GRID_BEHAVIORS = defineBehaviors({
    'tab-close': { run: () => closeTabAction(hostOf()?.viewId ?? useDocument.getState().activeViewId ?? ''), offered: () => hostOf() !== null },
    'close-cell': {
        run: () => closeCellAction(),
        /* A host closes its tab in front, and the cell goes with the last one, so one key walks out of a stack of tabs and then out of the cell that held them. Off macOS the window menu's Close answers Ctrl+W, so the key is always taken there. */
        key: (press) => {
            const tab = focusedClosableTab();
            if (tab !== null) {
                return takeKey(press, () => closeTabAction(tab));
            }
            const closes = useDocument.getState().layout !== null;
            if (closes || !press.apple) {
                press.event.preventDefault();
            }
            if (closes) {
                closeCellAction();
            }

            return true;
        }
    },
    'cell-close-others': {
        run: () => {
            const { layout } = useDocument.getState();
            if (layout !== null) {
                closeOtherCellsAction(layout.focus);
            }
        },
        offered: () => (useDocument.getState().layout === null ? false : cellCount(useDocument.getState().layout!) > 1)
    },
    'cell-close-right': {
        run: () => {
            const { layout } = useDocument.getState();
            if (layout !== null) {
                closeCellsRightOfAction(layout.focus);
            }
        },
        offered: () => {
            const { layout } = useDocument.getState();

            return layout !== null && cellCount(layout) > 1 && cellsRightOf(layout, layout.focus) > 0;
        }
    },
    'split-right': { run: () => splitAction('right'), key: (press) => takeKey(press, () => splitAction('right')) },
    'split-down': { run: () => splitAction('down'), key: (press) => takeKey(press, () => splitAction('down')) },
    'tab-move-left': movingTab(-1),
    'tab-move-right': movingTab(1),
    'tab-previous': steppingTab(-1),
    'tab-next': steppingTab(1),
    'tab-split-off': {
        run: () => {
            const host = hostOf();
            if (host !== null) {
                void useDocument.getState().splitTabOff(host.viewId);
            }
        },
        offered: () => {
            const host = hostOf();

            return host !== null && host.tabs.length > 1 && canSplit(host.layout, host.layout.focus, 'right', host.viewId);
        }
    },
    'tab-ungroup': {
        run: () => {
            const host = hostOf();
            if (host !== null) {
                useDocument.getState().ungroupCell(host.layout.focus);
            }
        },
        offered: () => hostOf()?.tabs.length === 1
    },
    'cell-maximize': {
        run: () => useDocument.getState().toggleMaximized(),
        offered: () => {
            const { layout, maximized } = useDocument.getState();
            if (layout === null || cellCount(layout) <= 1) {
                return false;
            }
            const filling = maximizedCell(layout, maximized) !== null;
            const onCanvas = useDocument.getState().views.some((view) => view.id === useDocument.getState().activeViewId && view.kind === 'canvas');
            // The key goes to a node first, so this row only shows it when no node would take it.
            const nodeTakesKey = onCanvas && maximizeTargetOf(focusedCanvas().getState()) !== null;

            return {
                ...(filling ? { label: i18next.t('shell:viewMenu.restoreSplit') } : {}),
                ...(nodeTakesKey ? { shortcut: null } : {})
            };
        },
        /* A node on the canvas goes first; without one the key is the grid's, and with one cell and nothing maximized it is let go, since there is nothing to fill. */
        key: (press) => {
            const canvas = focusedCanvas().getState();
            const node = onStandaloneView() ? null : maximizeTargetOf(canvas);
            if (node !== null) {
                return takeKey(press, () => canvas.toggleMaximizedNode(node));
            }
            const state = useDocument.getState();
            if (state.maximized !== null || (state.layout !== null && cellCount(state.layout) > 1)) {
                takeKey(press, () => state.toggleMaximized());
            }

            return true;
        }
    },
    'focus-left': focusing('left'),
    'focus-right': focusing('right'),
    'focus-up': focusing('up'),
    'focus-down': focusing('down'),
    'view-previous': steppingView(-1),
    'view-next': steppingView(1)
});
