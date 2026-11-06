import type { OutboxHandlers } from '@adecore/agents/coordination';
import { OUTBOX_KIND_NAMES } from './kinds.ts';
import type { OutboxWork } from './outbox.ts';

function refuse(entry: { kind: string }): Promise<never> {
    return Promise.reject(new Error(`no ${entry.kind} in these tests`));
}

/* A handler for every kind that refuses its entry, but for the kinds a test runs itself. */
export function refusingHandlers(own: Partial<OutboxHandlers<OutboxWork>>): OutboxHandlers<OutboxWork> {
    return { ...Object.fromEntries(OUTBOX_KIND_NAMES.map((kind) => [kind, refuse])), ...own } as OutboxHandlers<OutboxWork>;
}
