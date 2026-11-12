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

export const CANVAS_COMMANDS = {
    // A page cannot reach the browser's own undo, so the web client undoes what has a history of its own.
    'edit-undo': {
        key: 'undo',
        icon: Undo2,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 30, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    'edit-redo': {
        key: 'redo',
        icon: Redo2,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 40, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    'node-maximize': {
        key: 'maximizeNode',
        icon: Expand,
        keyOf: 'cell-maximize',
        palette: true,
        menu: {
            menu: 'view',
            group: 'split',
            order: 80,
            when: onCanvas,
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
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 10, when: zoomable }
    },
    'zoom-selection': {
        key: 'zoomToSelection',
        icon: Focus,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 20, when: zoomable }
    },
    'zoom-node': {
        key: 'zoomToNode',
        icon: Crosshair,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 30, when: onCanvas, enabled: (context) => context.nodeZoomable && !context.nodeMaximized }
    },
    'zoom-reset': {
        key: 'zoomReset',
        icon: Percent,
        binds: 'workspace',
        palette: true,
        menu: {
            menu: 'view',
            group: 'zoom',
            order: 40,
            when: (context) => zoomable(context) || context.chatTextSize !== null,
            words: (context) => ({ key: context.chatTextSize === null ? 'zoomReset' : 'chatTextReset' })
        }
    },
    'camera-back': {
        key: 'cameraBack',
        icon: ArrowLeft,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 30, when: onCanvas, enabled: (context) => context.cameraHistory.back }
    },
    'camera-forward': {
        key: 'cameraForward',
        icon: ArrowRight,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 40, when: onCanvas, enabled: (context) => context.cameraHistory.forward }
    },
    'node-left': {
        key: 'nodeLeft',
        icon: ArrowLeft,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 10, enabled: (context) => context.nodeNeighbors.left }
    },
    'node-right': {
        key: 'nodeRight',
        icon: ArrowRight,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 20, enabled: (context) => context.nodeNeighbors.right }
    },
    'node-up': {
        key: 'nodeUp',
        icon: ArrowUp,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 30, enabled: (context) => context.nodeNeighbors.up }
    },
    'node-down': {
        key: 'nodeDown',
        icon: ArrowDown,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 40, enabled: (context) => context.nodeNeighbors.down }
    },
    'add-terminal': {
        key: 'addTerminal',
        icon: Terminal,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 10 }
    },
    'add-chat': {
        key: 'addChat',
        icon: MessageSquare,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 20 }
    },
    'add-browser': {
        key: 'addBrowser',
        icon: Globe,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 30 }
    },
    'add-note': {
        key: 'addNote',
        icon: StickyNote,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 40 }
    },
    'add-text': { key: 'addText', icon: Type, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 50 } },
    'add-file': { key: 'addFile', icon: FileText, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 60, when: (context) => context.folder } },
    'add-group': {
        key: 'addGroup',
        icon: Group,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 70 }
    },
    'group-selection': {
        key: 'groupSelection',
        icon: SquareDashed,
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
