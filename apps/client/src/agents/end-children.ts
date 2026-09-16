import { create } from 'zustand';
import type { Transport } from '@/transport/transport';

export interface PendingEnd {
    /* What is about to go, for the title: a node's own title, or how many nodes. */
    what: string;
    agents: number;
    run(): void;
}

/* The one question up at a time; the dialog reads it, and whatever asks leaves the answer to it. */
export const useEndingAgents = create<{ pending: PendingEnd | null }>(() => ({ pending: null }));

/* The sentence the confirmation says, counting rather than hedging, like closing a project does. */
export const endsAgentsWarning = (agents: number): string =>
    `Also ends ${agents === 1 ? 'the agent' : `the ${agents} agents`} it opened. ${agents === 1 ? 'Its node stays' : 'Their nodes stay'} on the canvas with what ${agents === 1 ? 'it' : 'they'} did so far.`;

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

/* Runs a delete at once when it ends no agent of the machine's, and asks first when it does. */
export const askBeforeEndingAgents = async (
    transport: Pick<Transport, 'request'> | null,
    nodeIds: readonly string[],
    what: string,
    run: () => void
): Promise<void> => {
    const agents = await agentsEndedWith(transport, nodeIds);
    if (agents === 0) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { what, agents, run } });
};
