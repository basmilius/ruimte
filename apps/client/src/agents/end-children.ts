import type { Worktree } from '@ruimte/contracts';
import i18next from 'i18next';
import { create } from 'zustand';
import type { Transport } from '@/transport-api/transport';

export interface PendingEnd {
    /* What a delete or a stop names in its title; stopping a turn with its sub-agents has a title of its own. */
    what?: string;
    agents: number;
    /* A stop and a clear keep the node where it is; without an action the question is about a delete. */
    action?: 'delete' | 'stop' | 'stop-subagents' | 'clear';
    worktrees?: { folder: string; worktrees: readonly Worktree[] };
    run(): void;
}

export const useEndingAgents = create<{ pending: PendingEnd | null }>(() => ({ pending: null }));

export function endingTitle(pending: PendingEnd): string {
    if (pending.action === 'stop-subagents') {
        return i18next.t('agents:dialog.stopSubagentsTitle');
    }
    if (pending.action === 'clear') {
        return i18next.t('agents:dialog.clearTitle', { what: pending.what });
    }
    return i18next.t(pending.action === 'stop' ? 'agents:dialog.stopTitle' : 'agents:dialog.deleteTitle', { what: pending.what });
}

export function endsAgentsWarning(agents: number): string {
    return i18next.t('agents:ending.alsoEnds', { count: agents });
}

function withEndedAgents(text: string, agents: number): string {
    return agents === 0 ? text : `${text} ${endsAgentsWarning(agents)}`;
}

export function stopsTaskWarning(agents: number): string {
    return withEndedAgents(i18next.t('agents:ending.stopsTask'), agents);
}

export function clearsWarning(agents: number): string {
    return withEndedAgents(i18next.t('agents:ending.clears'), agents);
}

export function stopsSubagentsWarning(agents: number): string {
    return `${i18next.t('agents:ending.stopsSubagents')} ${endsAgentsWarning(agents)}`;
}

type Requester = Pick<Transport, 'request'>;

/* The machine to ask: one for every node, or the one each node runs on, which a canvas holding nodes of another machine needs. */
export type Asked = Requester | null | ((nodeId: string) => Requester | null);

/* The live agents these nodes opened, each once however many of them opened it. A machine that cannot be asked names none. */
export async function agentsEndedBy(transport: Asked, nodeIds: readonly string[]): Promise<string[]> {
    if (transport === null || nodeIds.length === 0) {
        return [];
    }
    const askerOf = typeof transport === 'function' ? transport : () => transport;
    const answers = await Promise.all(
        nodeIds.map(async (nodeId) => {
            const asker = askerOf(nodeId);
            return asker === null
                ? []
                : asker.request('agent.children', { nodeId }).then(
                      (result) => result.nodeIds,
                      () => [] as string[]
                  );
        })
    );
    const going = new Set(nodeIds);
    return [...new Set(answers.flat().filter((id) => !going.has(id)))];
}

export async function agentsEndedWith(transport: Asked, nodeIds: readonly string[]): Promise<number> {
    return (await agentsEndedBy(transport, nodeIds)).length;
}

/*
 * Asks first when the delete would end an agent or leave a worktree behind. A worktree is never
 * removed on its own, so the moment its node goes is when a person sees that it stays.
 */
export async function askBeforeEndingAgents(
    transport: Asked,
    nodeIds: readonly string[],
    what: string,
    run: () => void,
    worktrees?: () => Promise<PendingEnd['worktrees']>
): Promise<void> {
    const [agents, left] = await Promise.all([agentsEndedWith(transport, nodeIds), worktrees?.().catch(() => undefined)]);
    const offered = left !== undefined && left.worktrees.length > 0 ? left : undefined;
    if (agents === 0 && offered === undefined) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { what, agents, run, ...(offered === undefined ? {} : { worktrees: offered }) } });
}

// Stopping a task always removes its node, so this confirmation cannot use the delete shortcut above.
export async function askBeforeStoppingTask(transport: Requester | null, childId: string, what: string, run: () => void): Promise<void> {
    const agents = await agentsEndedWith(transport, [childId]);
    useEndingAgents.setState({ pending: { what, agents, action: 'stop', run } });
}

export async function askBeforeStoppingSubagents(transport: Requester | null, chatId: string, run: () => void): Promise<void> {
    const agents = await agentsEndedWith(transport, [chatId]);
    if (agents === 0) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { agents, action: 'stop-subagents', run } });
}

/*
 * A menu row sits one click from Delete, the history cannot come back and a clear ends the chat's
 * children, so unlike the composer's `/clear` this always asks.
 */
export async function askBeforeClearingChat(transport: Requester | null, chatId: string, what: string, run: () => void): Promise<void> {
    const agents = await agentsEndedWith(transport, [chatId]);
    useEndingAgents.setState({ pending: { what, agents, action: 'clear', run } });
}
