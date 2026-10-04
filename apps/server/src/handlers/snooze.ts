import type { SnoozeStore } from '../push/snoozes.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';

/* `locate` is the project index's; a snooze is kept against the project its node is in. */
export function registerSnoozeHandlers(dispatcher: Dispatcher, snoozes: SnoozeStore, locate: (nodeId: string) => { projectId: string } | null): void {
    dispatcher.register('snooze.list', () => ({ snoozes: snoozes.list() }));
    dispatcher.register('snooze.set', ({ nodeId, until }) => {
        const place = locate(nodeId);
        if (!place) {
            throw new RequestError('node-not-found', `No project here has a node ${nodeId}`);
        }
        snoozes.set(place.projectId, nodeId, until);
        return {};
    });
    dispatcher.register('snooze.clear', ({ nodeId }) => {
        snoozes.clear(nodeId);
        return {};
    });
}
