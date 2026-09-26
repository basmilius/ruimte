import type { ChatBackgroundTask } from '@ruimte/agent-contracts';

export const backgroundCounts = (tasks: readonly ChatBackgroundTask[]): { shells: number; monitors: number } => ({
    shells: tasks.filter((task) => task.kind === 'shell').length,
    monitors: tasks.filter((task) => task.kind === 'monitor').length
});
