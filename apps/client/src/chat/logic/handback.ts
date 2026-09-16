import type { ChatItem } from '@ruimte/contracts';

/*
 * What Claude Code leaves as a background agent's result once the agent handed its report back with
 * `SubagentHandback`: a fixed notice with the agent's id, not a report. Only that opening is matched,
 * so a report that happens to mention a message is never taken for it.
 */
const HANDBACK_NOTICE = /^This agent's report was delivered to you as a message from "[^"\s]+"/;

export const isHandbackNotice = (text: string | null | undefined): boolean => typeof text === 'string' && HANDBACK_NOTICE.test(text.trim());

/* The report a `SubagentHandback` call carries in `input.message` (Claude Code 2.1.273), or null for any other item. */
export const handbackReportOf = (item: ChatItem): string | null => {
    if (item.kind !== 'tool' || item.name !== 'SubagentHandback' || typeof item.input !== 'object' || item.input === null) {
        return null;
    }
    const message = (item.input as { message?: unknown }).message;
    return typeof message === 'string' && message.trim() !== '' ? message : null;
};

/* The last report handed back among these items. */
export const lastHandbackReport = (items: readonly ChatItem[]): string | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const report = handbackReportOf(items[i]!);
        if (report !== null) {
            return report;
        }
    }
    return null;
};
