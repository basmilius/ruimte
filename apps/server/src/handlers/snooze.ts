import { CodedError } from '@adecore/agents';
import type { Area } from '../area.ts';
import type { SnoozeStore } from '../push/snoozes.ts';

export interface SnoozeDeps {
    snoozes: SnoozeStore;
    /* The project index's; a snooze is kept against the project its node is in. */
    locate(nodeId: string): { projectId: string } | null;
}

export function snoozeArea({ snoozes, locate }: SnoozeDeps): Area {
    return {
        name: 'snooze',
        sources: [snoozes],
        handlers: (dispatcher) => {
            dispatcher.register('snooze.list', () => ({ snoozes: snoozes.list() }));
            dispatcher.register('snooze.set', ({ nodeId, until }) => {
                const place = locate(nodeId);
                if (!place) {
                    throw new CodedError('node-not-found', `No project here has a node ${nodeId}`);
                }
                snoozes.set(place.projectId, nodeId, until);
                return {};
            });
            dispatcher.register('snooze.clear', ({ nodeId }) => {
                snoozes.clear(nodeId);
                return {};
            });
        },
        stop: [{ phase: 'halt', label: 'Stopping snoozes', run: () => snoozes.stop() }]
    };
}
