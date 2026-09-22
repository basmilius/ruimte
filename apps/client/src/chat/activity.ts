import type { ChatBackgroundTask, ChatItem } from '@ruimte/contracts';

/* The sub-agents of the CLI's own still at work; a task of Ruimte's runs as a node of its own and shows there. */
export const runningOwnSubagents = (structure: Readonly<Record<string, ChatItem>> | undefined): number =>
    structure === undefined
        ? 0
        : Object.values(structure).filter((item) => item.kind === 'subagent' && item.status === 'running' && item.origin !== 'ruimte').length;

export const backgroundCounts = (tasks: readonly ChatBackgroundTask[]): { shells: number; monitors: number } => ({
    shells: tasks.filter((task) => task.kind === 'shell').length,
    monitors: tasks.filter((task) => task.kind === 'monitor').length
});
