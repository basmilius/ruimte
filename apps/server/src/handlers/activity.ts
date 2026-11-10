import { CodedError } from '@adecore/agents';
import type { NodeActivityStore } from '../activity/node-activity.ts';
import type { Area } from '../area.ts';

interface ActivityDeps {
    activity: NodeActivityStore;
}

export function activityArea({ activity }: ActivityDeps): Area {
    return {
        name: 'activity',
        sources: [activity],
        handlers: (dispatcher) => {
            dispatcher.register('activity.list', () => ({ activity: activity.list() }));
            dispatcher.register('activity.touch', ({ nodeId }) => {
                if (!activity.touch(nodeId)) {
                    throw new CodedError('node-not-found', `No project here has a node ${nodeId}`);
                }

                return {};
            });
        }
    };
}
