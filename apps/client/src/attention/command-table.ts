import { Hourglass, Inbox, ListChecks } from 'lucide-react';
import { onCanvas } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';

export const ATTENTION_COMMANDS = {
    prompts: {
        key: 'prompts',
        icon: Inbox,
        shortcut: CANVAS_SHORTCUTS.focusPrompts,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'prompts', order: 10, when: onCanvas, enabled: (context) => context.promptStack }
    },
    // From anywhere, a terminal included, as the prompts key is.
    'needs-you-next': {
        key: 'nextNeedsYou',
        icon: Hourglass,
        shortcut: CANVAS_SHORTCUTS.nextNeedsYou,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 20, enabled: (context) => context.somethingWaits }
    },
    'attention-queue': {
        key: 'attentionQueue',
        icon: ListChecks,
        shortcut: CANVAS_SHORTCUTS.attentionQueue,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 30 }
    }
} satisfies Record<string, CommandSpec>;
