import type { OutboxHandlers } from '@adecore/agents/coordination';
import type { OutboxWork } from './outbox.ts';

function refuse(entry: { kind: string }): Promise<never> {
    return Promise.reject(new Error(`no ${entry.kind} in these tests`));
}

/* A handler for every kind that refuses its entry, but for the kinds a test runs itself. */
export function refusingHandlers(own: Partial<OutboxHandlers<OutboxWork>>): OutboxHandlers<OutboxWork> {
    return {
        'start-agent': refuse,
        'resume-run': refuse,
        'resume-limit': refuse,
        'background-limit': refuse,
        'wake-parent': refuse,
        'give-task': refuse,
        'deliver-message': refuse,
        'end-children': refuse,
        'deliver-summary': refuse,
        'deliver-waiting': refuse,
        'deliver-pr-watch': refuse,
        'deliver-answer': refuse,
        'run-after-settle': refuse,
        'connect-peer': refuse,
        'deliver-remote-result': refuse,
        'start-remote-agent': refuse,
        'stop-remote-agent': refuse,
        'take-remote-result': refuse,
        'routine-run': refuse,
        ...own
    };
}
