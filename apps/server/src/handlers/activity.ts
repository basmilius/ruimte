import type { NodeActivityStore } from '../activity/node-activity.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';

export function registerActivityHandlers(dispatcher: Dispatcher, activity: NodeActivityStore): void {
    dispatcher.register('activity.list', () => ({ activity: activity.list() }));
    dispatcher.register('activity.touch', ({ nodeId }) => {
        if (!activity.touch(nodeId)) {
            throw new RequestError('node-not-found', `No project here has a node ${nodeId}`);
        }

        return {};
    });
}
