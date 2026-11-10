import type { Area } from '../area.ts';
import type { AgentWorkBundle } from './agent-work.ts';

/*
 * The outbox worker and what coordinates tasks belong to no request. Tasks settle before the
 * terminals go, and the chats are written after they have.
 */
export function agentWorkLifecycle({ worker, tasks, summaries }: AgentWorkBundle): Area {
    return {
        name: 'agent work',
        stop: [
            { phase: 'halt', label: 'Stopping the outbox worker', run: () => worker.stop() },
            { phase: 'halt', label: 'Stopping the task coordinator', run: () => tasks.coordinator.stop() },
            { phase: 'halt', label: 'Stopping waiting tasks', run: () => tasks.waiting.stop() },
            { phase: 'halt', label: 'Stopping summaries', run: () => summaries.coordinator.stop() },
            { phase: 'drain', label: 'Settling tasks', run: () => tasks.coordinator.settled() }
        ]
    };
}
