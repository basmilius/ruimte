import { SEND_AND_NEW_SHORTCUT } from '@adecore/agents-react/chat';
import {
    ChevronDown,
    ChevronsDown,
    ChevronsUp,
    ChevronUp,
    FolderInput,
    FolderPlus,
    GitFork,
    MessageSquarePlus,
    MessageSquareText,
    RotateCw,
    SendHorizontal
} from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/surface/shortcuts';

export const CHAT_COMMANDS = {
    'chat-new': {
        key: 'newChat',
        icon: MessageSquarePlus,
        shortcut: APP_SHORTCUTS.newChat,
        binds: 'window',
        palette: true,
        menu: { menu: 'file', group: 'new', order: 20, when: (context) => context.newChat }
    },
    // The composer answers the key itself.
    'chat-send-new': {
        key: 'sendAndNewChat',
        icon: SendHorizontal,
        shortcut: SEND_AND_NEW_SHORTCUT,
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 10 }
    },
    'chat-restart': { key: 'restartAgentSession', icon: RotateCw, palette: true, menu: { menu: 'kind', group: 'chat', order: 20 } },
    'chat-effort-up': {
        key: 'raiseEffort',
        icon: ChevronsUp,
        shortcut: CANVAS_SHORTCUTS.raiseEffort,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 30 }
    },
    'chat-effort-down': {
        key: 'lowerEffort',
        icon: ChevronsDown,
        shortcut: CANVAS_SHORTCUTS.lowerEffort,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 40 }
    },
    /* No key here: Alt+Up and Alt+Down are the Go menu's node rows, and the canvas listener steps the
       messages first while the keyboard is in a chat's thread. */
    'chat-message-previous': { key: 'previousMessage', icon: ChevronUp, palette: true, menu: { menu: 'kind', group: 'chat', order: 50 } },
    'chat-message-next': { key: 'nextMessage', icon: ChevronDown, palette: true, menu: { menu: 'kind', group: 'chat', order: 60 } },
    'chat-make-project': {
        key: 'makeProject',
        icon: FolderPlus,
        palette: true,
        menu: { menu: 'kind', group: 'place', order: 5, when: (context) => context.offers?.makeProject === true, enabled: (context) => !context.chatWorking }
    },
    // The submenu's last row; its recent projects are generated rows (`menu/model.ts`).
    'chat-move-to-project': {
        key: 'moveToProject',
        icon: FolderInput,
        palette: true,
        menu: { menu: 'chat-move', group: 'other', order: 100, words: () => ({ key: 'otherProject' }) }
    },
    'search-chats': {
        key: 'searchChats',
        icon: MessageSquareText,
        palette: true,
        menu: { menu: 'edit', group: 'search', order: 30, when: (context) => context.workspace }
    },
    'view-fork': {
        key: 'fork',
        icon: GitFork,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 10, when: (context) => context.offers?.fork === true }
    }
} satisfies Record<string, CommandSpec>;
