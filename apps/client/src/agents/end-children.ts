import i18next from 'i18next';
import { create } from 'zustand';
import type { Worktree } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';

export interface PendingEnd {
    what: string;
    agents: number;
    /* A stop keeps the node where it is; without one the question is about a delete. */
    action?: 'delete' | 'stop' | 'stop-subagents';
    worktrees?: { folder: string; worktrees: readonly Worktree[] };
    run(): void;
}

export const useEndingAgents = create<{ pending: PendingEnd | null }>(() => ({ pending: null }));

export const endsAgentsWarning = (agents: number): string => i18next.t('agents:ending.alsoEnds', { count: agents });

export const stopsTaskWarning = (agents: number): string => `${i18next.t('agents:ending.stopsTask')}${agents === 0 ? '' : ` ${endsAgentsWarning(agents)}`}`;

export const stopsSubagentsWarning = (agents: number): string => `${i18next.t('agents:ending.stopsSubagents')} ${endsAgentsWarning(agents)}`;

/*
 * The live agents these nodes opened, counted once however many of them opened the same one. A
 * machine that does not know the question (or cannot be asked) counts none, which is how deleting
 * worked before it ended anything.
 */
export const agentsEndedWith = async (transport: Pick<Transport, 'request'> | null, nodeIds: readonly string[]): Promise<number> => {
    if (transport === null || nodeIds.length === 0) {
        return 0;
    }
    const answers = await Promise.all(
        nodeIds.map((nodeId) =>
            transport
                .request('agent.children', { nodeId })
                .then((result) => result.nodeIds)
                .catch(() => [] as string[])
        )
    );
    const going = new Set(nodeIds);
    return new Set(answers.flat().filter((id) => !going.has(id))).size;
};

/*
 * Asks first when the delete would end an agent or leave a worktree behind. A worktree is never
 * removed on its own, so the moment its node goes is when a person sees that it stays.
 */
export const askBeforeEndingAgents = async (
    transport: Pick<Transport, 'request'> | null,
    nodeIds: readonly string[],
    what: string,
    run: () => void,
    worktrees?: () => Promise<PendingEnd['worktrees']>
): Promise<void> => {
    const [agents, left] = await Promise.all([agentsEndedWith(transport, nodeIds), worktrees?.().catch(() => undefined)]);
    const offered = left !== undefined && left.worktrees.length > 0 ? left : undefined;
    if (agents === 0 && offered === undefined) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { what, agents, run, ...(offered === undefined ? {} : { worktrees: offered }) } });
};

// Stopping a task always removes its node, so this confirmation cannot use the delete shortcut above.
export const askBeforeStoppingTask = async (transport: Pick<Transport, 'request'> | null, childId: string, what: string, run: () => void): Promise<void> => {
    const agents = await agentsEndedWith(transport, [childId]);
    useEndingAgents.setState({ pending: { what, agents, action: 'stop', run } });
};

export const askBeforeStoppingSubagents = async (transport: Pick<Transport, 'request'> | null, chatId: string, run: () => void): Promise<void> => {
    const agents = await agentsEndedWith(transport, [chatId]);
    if (agents === 0) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { what: 'the turn and its sub-agents', agents, action: 'stop-subagents', run } });
};
