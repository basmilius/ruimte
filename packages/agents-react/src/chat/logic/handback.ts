import type { ChatItem } from '@ruimte/agent-contracts';

/* The report a `SubagentHandback` call carries in `input.message` (Claude Code 2.1.273), or null for any other item. */
export const handbackReportOf = (item: ChatItem): string | null => {
    if (item.kind !== 'tool' || item.name !== 'SubagentHandback' || typeof item.input !== 'object' || item.input === null) {
        return null;
    }
    const message = (item.input as { message?: unknown }).message;
    return typeof message === 'string' && message.trim() !== '' ? message : null;
};
