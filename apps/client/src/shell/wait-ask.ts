import i18next from 'i18next';
import type { WaitAsk } from '@ruimte/contracts';

const LINES = {
    command: { detail: 'shell:notifications.asks.command', bare: 'shell:notifications.asks.commandBare' },
    edit: { detail: 'shell:notifications.asks.edit', bare: 'shell:notifications.asks.editBare' },
    tool: { detail: 'shell:notifications.asks.tool', bare: 'shell:notifications.asks.toolBare' },
    question: { detail: 'shell:notifications.asks.question', bare: 'shell:notifications.asks.questionBare' }
} as const;

/* One line on what a waiting node asks, in the person's language; the command or the question stays in the agent's words. */
export function waitAskLine(ask: WaitAsk): string {
    const keys = LINES[ask.kind];
    const line = ask.detail === null ? i18next.t(keys.bare, { tool: ask.tool }) : i18next.t(keys.detail, { tool: ask.tool, detail: ask.detail });

    return ask.more > 0 ? i18next.t('shell:notifications.asks.more', { line, count: ask.more }) : line;
}
