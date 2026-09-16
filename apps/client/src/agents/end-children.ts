import { create } from 'zustand';
import type { Transport } from '@/transport/transport';

export interface PendingEnd {
    /* What is about to go, for the title: a node's own title, or how many nodes. */
    what: string;
    agents: number;
    /* A stop keeps the node where it is; without one the question is about a delete. */
    action?: 'delete' | 'stop' | 'stop-subagents';
    run(): void;
}

/* The one question up at a time; the dialog reads it, and whatever asks leaves the answer to it. */
export const useEndingAgents = create<{ pending: PendingEnd | null }>(() => ({ pending: null }));

/* The sentence the confirmation says, counting rather than hedging, like closing a project does. */
export const endsAgentsWarning = (agents: number): string =>
    `Also ends ${agents === 1 ? 'the agent' : `the ${agents} agents`} it opened. ${agents === 1 ? 'Its node stays' : 'Their nodes stay'} on the canvas with what ${agents === 1 ? 'it' : 'they'} did so far.`;

/* What stopping a task from the chat that gave it says, with the agents the task's node opened counted after it. */
export const stopsTaskWarning = (agents: number): string =>
    `Ends the agent working on this task and cancels the task without waking the chat that gave it. Its node stays on the canvas.${agents === 0 ? '' : ` ${endsAgentsWarning(agents)}`}`;

/* What stopping a chat's turn together with its sub-agents says, once it ends agents the chat opened. */
export const stopsSubagentsWarning = (agents: number): string => `Stops the turn and marks the chat's own sub-agents as stopped. ${endsAgentsWarning(agents)}`;

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

/* A task's node always ends when it is stopped, so this asks every time, counting what goes with it. */
export const askBeforeStoppingTask = async (transport: Pick<Transport, 'request'> | null, childId: string, what: string, run: () => void): Promise<void> => {
    const agents = await agentsEndedWith(transport, [childId]);
    useEndingAgents.setState({ pending: { what, agents, action: 'stop', run } });
};

/* Stops a chat's turn with its sub-agents at once when that ends no agent the chat opened, and asks first when it does. */
export const askBeforeStoppingSubagents = async (transport: Pick<Transport, 'request'> | null, chatId: string, run: () => void): Promise<void> => {
    const agents = await agentsEndedWith(transport, [chatId]);
    if (agents === 0) {
        run();
        return;
    }
    useEndingAgents.setState({ pending: { what: 'the turn and its sub-agents', agents, action: 'stop-subagents', run } });
};
