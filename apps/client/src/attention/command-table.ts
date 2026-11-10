import { Hourglass, Inbox, ListChecks } from 'lucide-react';
import { onCanvas } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';

export const ATTENTION_COMMANDS = {
    prompts: {
        key: 'prompts',
        icon: Inbox,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'prompts', order: 10, when: onCanvas, enabled: (context) => context.promptStack }
    },
    // From anywhere, a terminal included, as the prompts key is.
    'needs-you-next': {
        key: 'nextNeedsYou',
        icon: Hourglass,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 20, enabled: (context) => context.somethingWaits }
    },
    'attention-queue': {
        key: 'attentionQueue',
        icon: ListChecks,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 30 }
    }
} satisfies Record<string, CommandSpec>;
