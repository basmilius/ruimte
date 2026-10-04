import type { ChatBackgroundTask } from '@ruimte/agent-contracts';

export function backgroundCounts(tasks: readonly ChatBackgroundTask[]): { shells: number; monitors: number } {
    return {
        shells: tasks.filter((task) => task.kind === 'shell').length,
        monitors: tasks.filter((task) => task.kind === 'monitor').length
    };
}
