import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowRightToLine,
    ArrowUp,
    ChevronsLeft,
    ChevronsRight,
    Expand,
    ListX,
    PanelBottom,
    PanelRight,
    X
} from 'lucide-react';
import { desktop, severalCells, hosted } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';

export const GRID_COMMANDS = {
    // The key is bound once, through Close Cell, which closes the tab in front of a host first.
    'tab-close': {
        key: 'closeTab',
        icon: X,
        keyOf: 'close-cell',
        palette: true,
        menu: { menu: 'file', group: 'close', order: 20, when: (context) => context.workspace && hosted(context) }
    },
    // Without a cell the desktop app closes the window in its place; in a host the key is the tab's.
    'close-cell': {
        key: 'closeCell',
        icon: X,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'file',
            group: 'close',
            order: 30,
            when: (context) => context.workspace && (context.cells > 0 || !desktop(context)),
            enabled: (context) => (context.cells > 0 ? undefined : false),
            showsShortcut: (context) => context.cells > 0 && !hosted(context)
        }
    },
    'cell-close-others': {
        key: 'closeOtherCells',
        icon: ListX,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 40, when: (context) => context.workspace, enabled: severalCells }
    },
    'cell-close-right': {
        key: 'closeCellsRight',
        icon: ArrowRightToLine,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 50, when: (context) => context.workspace, enabled: (context) => context.closesRight }
    },
    'split-right': {
        key: 'splitRight',
        icon: PanelRight,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'split', order: 10, enabled: (context) => context.split.right }
    },
    'split-down': {
        key: 'splitDown',
        icon: PanelBottom,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'split', order: 20, enabled: (context) => context.split.down }
    },
    'tab-move-left': {
        key: 'moveTabLeft',
        icon: ArrowLeft,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'split', order: 30, when: hosted, enabled: (context) => context.tabs.index > 0 }
    },
    'tab-move-right': {
        key: 'moveTabRight',
        icon: ArrowRight,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'split', order: 40, when: hosted, enabled: (context) => context.tabs.index < context.tabs.count - 1 }
    },
    'tab-split-off': {
        key: 'moveTabToNewCell',
        icon: PanelRight,
        palette: true,
        menu: { menu: 'view', group: 'split', order: 50, when: hosted, enabled: (context) => context.tabs.splitOff }
    },
    // One key for both: a node on the canvas takes it first (`maximizeTargetOf`), so the row it acts on shows it.
    'cell-maximize': {
        key: 'maximizeCell',
        icon: Expand,
        binds: 'workspace',
        palette: true,
        menu: {
            menu: 'view',
            group: 'split',
            order: 70,
            enabled: severalCells,
            checked: (context) => context.maximized,
            showsShortcut: (context) => !context.nodeMaximizable
        }
    },
    'tab-previous': {
        key: 'previousTab',
        icon: ArrowLeft,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 50, when: hosted, enabled: (context) => context.tabs.count > 1 }
    },
    'tab-next': {
        key: 'nextTab',
        icon: ArrowRight,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 60, when: hosted, enabled: (context) => context.tabs.count > 1 }
    },
    'focus-left': {
        key: 'focusLeft',
        icon: ArrowLeft,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 10, enabled: (context) => context.cellNeighbors.left }
    },
    'focus-right': {
        key: 'focusRight',
        icon: ArrowRight,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 20, enabled: (context) => context.cellNeighbors.right }
    },
    'focus-up': {
        key: 'focusUp',
        icon: ArrowUp,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 30, enabled: (context) => context.cellNeighbors.up }
    },
    'focus-down': {
        key: 'focusDown',
        icon: ArrowDown,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 40, enabled: (context) => context.cellNeighbors.down }
    },
    'view-previous': {
        key: 'previousView',
        icon: ChevronsLeft,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'views', order: 10, enabled: (context) => context.viewsSteppable }
    },
    'view-next': {
        key: 'nextView',
        icon: ChevronsRight,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'views', order: 20, enabled: (context) => context.viewsSteppable }
    }
} satisfies Record<string, CommandSpec>;
