import {
    Copy,
    CornerUpRight,
    FileText,
    Flag,
    Frame,
    Globe,
    Heading,
    MessageSquare,
    Minus,
    PenTool,
    Settings2,
    Terminal,
    Trash,
    Users,
    Workflow
} from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const VIEW_COMMANDS = {
    'view-new': {
        key: 'newCanvasView',
        icon: Frame,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'new-view', group: 'views', order: 10 }
    },
    'view-new-drawing': { key: 'newDrawingView', icon: PenTool, palette: true, menu: { menu: 'new-view', group: 'views', order: 20 } },
    'view-new-diagram': { key: 'newDiagramView', icon: Workflow, palette: true, menu: { menu: 'new-view', group: 'views', order: 30 } },
    'view-new-terminal': { key: 'newTerminalView', icon: Terminal, palette: true, menu: { menu: 'new-view', group: 'views', order: 40 } },
    'view-new-file': {
        key: 'newFileView',
        icon: FileText,
        palette: true,
        menu: { menu: 'new-view', group: 'views', order: 50, when: (context) => context.folder }
    },
    'view-new-browser': { key: 'newBrowserView', icon: Globe, palette: true, menu: { menu: 'new-view', group: 'views', order: 60 } },
    'view-new-separator': { key: 'newSeparator', icon: Minus, palette: true, menu: { menu: 'new-view', group: 'dividers', order: 10 } },
    'view-new-subheader': { key: 'newSubheader', icon: Heading, palette: true, menu: { menu: 'new-view', group: 'dividers', order: 20 } },
    'view-put-on-canvas': {
        key: 'putOnCanvas',
        icon: Frame,
        palette: false,
        menu: { menu: 'kind', group: 'place', order: 10, when: (context) => context.offers?.putOnCanvas === true }
    },
    // The palette's own way to the same thing as Put on Canvas, for a session view only.
    'view-demote': { key: 'putOnCanvas', icon: Frame, palette: true },
    'view-reveal': {
        key: 'reveal',
        icon: CornerUpRight,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'place',
            order: 20,
            when: (context) => context.offers?.reveal === true,
            words: (context) => ({ key: 'reveal', values: { app: context.fileManager } })
        }
    },
    'view-share': {
        key: 'share',
        icon: Users,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'settings',
            order: 10,
            when: (context) => context.offers?.share === true,
            words: (context) => ({ key: context.shared ? 'unshare' : 'share' })
        }
    },
    'flag-toggle': {
        key: 'toggleFlag',
        icon: Flag,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'settings', order: 20 }
    },
    'view-settings': { key: 'viewSettings', icon: Settings2, palette: true, menu: { menu: 'kind', group: 'settings', order: 30 } },
    'view-delete': { key: 'deleteView', icon: Trash, palette: true, menu: { menu: 'kind', group: 'delete', order: 10 } },
    'view-duplicate': {
        key: 'duplicate',
        icon: Copy,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 40, when: (context) => context.offers?.duplicate === true }
    },
    'view-open-in-chat': {
        key: 'openInChat',
        icon: MessageSquare,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 20, when: (context) => context.offers?.openInChat === true }
    },
    'view-open-in-terminal': {
        key: 'openInTerminal',
        icon: Terminal,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 30, when: (context) => context.offers?.openInTerminal === true }
    }
} satisfies Record<string, CommandSpec>;
