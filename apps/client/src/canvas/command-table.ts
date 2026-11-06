import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Crosshair,
    Expand,
    FileText,
    Focus,
    Globe,
    Group,
    LayoutGrid,
    Lock,
    Maximize2,
    MessageSquare,
    Percent,
    Redo2,
    Save,
    SquareArrowOutUpRight,
    SquareDashed,
    StickyNote,
    Terminal,
    Type,
    Undo2
} from 'lucide-react';
import { zoomable, desktop, onCanvas } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS, NODE_NAVIGATION_SHORTCUTS } from '@/surface/canvas/shortcuts';

export const CANVAS_COMMANDS = {
    // A page cannot reach the browser's own undo, so the web client undoes what has a history of its own.
    'edit-undo': {
        key: 'undo',
        icon: Undo2,
        shortcut: CANVAS_SHORTCUTS.undo,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 30, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    'edit-redo': {
        key: 'redo',
        icon: Redo2,
        shortcut: CANVAS_SHORTCUTS.redo,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 40, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    'node-maximize': {
        key: 'maximizeNode',
        icon: Expand,
        shortcut: CANVAS_SHORTCUTS.maximizeCell,
        palette: true,
        menu: {
            menu: 'view',
            group: 'split',
            order: 80,
            enabled: (context) => context.nodeMaximizable,
            checked: (context) => context.nodeMaximized,
            showsShortcut: (context) => context.nodeMaximizable
        }
    },
    'note-lock-preview': {
        key: 'lockNotePreview',
        icon: Lock,
        palette: true
    },
    fit: {
        key: 'zoomToFit',
        icon: Maximize2,
        shortcut: CANVAS_SHORTCUTS.fitAll,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 10, enabled: zoomable }
    },
    'zoom-selection': {
        key: 'zoomToSelection',
        icon: Focus,
        shortcut: CANVAS_SHORTCUTS.zoomSelection,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 20, enabled: zoomable }
    },
    'zoom-node': {
        key: 'zoomToNode',
        icon: Crosshair,
        shortcut: CANVAS_SHORTCUTS.zoomNode,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 30, when: onCanvas, enabled: (context) => context.nodeZoomable && !context.nodeMaximized }
    },
    'zoom-reset': {
        key: 'zoomReset',
        icon: Percent,
        shortcut: CANVAS_SHORTCUTS.zoomReset,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 40, enabled: zoomable }
    },
    'camera-back': {
        key: 'cameraBack',
        icon: ArrowLeft,
        shortcut: CANVAS_SHORTCUTS.cameraBack,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 30, when: onCanvas, enabled: (context) => context.cameraHistory.back }
    },
    'camera-forward': {
        key: 'cameraForward',
        icon: ArrowRight,
        shortcut: CANVAS_SHORTCUTS.cameraForward,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 40, when: onCanvas, enabled: (context) => context.cameraHistory.forward }
    },
    'node-left': {
        key: 'nodeLeft',
        icon: ArrowLeft,
        shortcut: NODE_NAVIGATION_SHORTCUTS.left,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 10, enabled: (context) => context.nodeNeighbors.left }
    },
    'node-right': {
        key: 'nodeRight',
        icon: ArrowRight,
        shortcut: NODE_NAVIGATION_SHORTCUTS.right,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 20, enabled: (context) => context.nodeNeighbors.right }
    },
    'node-up': {
        key: 'nodeUp',
        icon: ArrowUp,
        shortcut: NODE_NAVIGATION_SHORTCUTS.up,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 30, enabled: (context) => context.nodeNeighbors.up }
    },
    'node-down': {
        key: 'nodeDown',
        icon: ArrowDown,
        shortcut: NODE_NAVIGATION_SHORTCUTS.down,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 40, enabled: (context) => context.nodeNeighbors.down }
    },
    'add-terminal': {
        key: 'addTerminal',
        icon: Terminal,
        shortcut: ADD_NODE_SHORTCUTS.terminal,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 10 }
    },
    'add-chat': {
        key: 'addChat',
        icon: MessageSquare,
        shortcut: ADD_NODE_SHORTCUTS.chat,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 20 }
    },
    'add-browser': {
        key: 'addBrowser',
        icon: Globe,
        shortcut: ADD_NODE_SHORTCUTS.browser,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 30 }
    },
    'add-note': {
        key: 'addNote',
        icon: StickyNote,
        shortcut: ADD_NODE_SHORTCUTS.note,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 40 }
    },
    'add-text': { key: 'addText', icon: Type, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 50 } },
    'add-file': { key: 'addFile', icon: FileText, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 60, when: (context) => context.folder } },
    'add-group': {
        key: 'addGroup',
        icon: Group,
        shortcut: ADD_NODE_SHORTCUTS.group,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 70 }
    },
    'group-selection': {
        key: 'groupSelection',
        icon: SquareDashed,
        shortcut: CANVAS_SHORTCUTS.group,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 10, enabled: (context) => context.selection > 0 }
    },
    'group-arrange': {
        key: 'arrangeGroup',
        icon: LayoutGrid,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 20, enabled: (context) => context.groupArrangeable }
    },
    'view-promote': {
        key: 'openAsView',
        icon: SquareArrowOutUpRight,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 30, enabled: (context) => context.promote }
    },
    lock: {
        key: 'lockAll',
        icon: Lock,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-layout', order: 10, words: (context) => ({ key: context.anyLocked ? 'unlockAll' : 'lockAll' }) }
    },
    'layout-save': { key: 'saveLayout', icon: Save, palette: true, menu: { menu: 'layouts', group: 'save', order: 10 } }
} satisfies Record<string, CommandSpec>;
