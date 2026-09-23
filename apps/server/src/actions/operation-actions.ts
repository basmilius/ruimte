import { OPERATION_ACTIONS, type ActionHandlers, type ActionOutput, type OperationStatus } from '@ruimte/actions';
import type { Task } from '@ruimte/contracts';
import { VerbRefusal, type AgentState, type AgentStateHost, type CanvasHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

type OperationAction = (typeof OPERATION_ACTIONS)[number];

type AgentOperation = ActionOutput<'operation.get'>['agents'][number];

/*
 * An operation id names the action and the nodes it started, so an operation is read off the state
 * those nodes already have and needs no store of its own, across a restart too.
 */
export const operationIdOf = (action: OperationAction, nodeIds: readonly string[]): string => `${action}:${nodeIds.join(',')}`;

export const OPERATION_FORMS: readonly string[] = [
    'operation\tagent.start:<id>\tthe start of one agent, under the id of its node',
    'operation\tteam.start:<id>,<id>\tthe start of a team, under the ids of its roles in the order they were made'
];

const parseOperationId = (operationId: string): { action: OperationAction; nodeIds: string[] } | null => {
    const colon = operationId.indexOf(':');
    const action = OPERATION_ACTIONS.find((candidate) => candidate === operationId.slice(0, colon));
    const nodeIds = operationId.slice(colon + 1).split(',');
    if (colon === -1 || action === undefined || nodeIds.some((id) => id === '')) {
        return null;
    }
    return { action, nodeIds };
};

/* The task a start gave its agent: the first one the caller gave that node, since a later task is its own. */
const startTask = (host: CanvasHost, caller: string, nodeId: string): Task | undefined =>
    host.tasks.involving(nodeId).find((task) => task.childId === nodeId && task.parentId === caller);

/*
 * Whether a node of an operation id is a start of this caller's. A node that is here and no agent the
 * caller started is refused, so a note never reads as an agent whose start gave up; a node that is gone
 * counts when a task or the lineage still says it was the caller's.
 */
const isOwnStart = (host: CanvasHost, agents: AgentStateHost, caller: string, nodeId: string, operationId: string, verb: 'follow' | 'cancel'): boolean => {
    const startedBy = agents.startedBy(nodeId);
    if (host.locate(nodeId) === null) {
        return startedBy === caller || startTask(host, caller, nodeId) !== undefined;
    }
    if (startedBy === caller) {
        return true;
    }
    if (startedBy !== null) {
        throw new VerbRefusal('not-yours', `${nodeId} is not an agent you opened, so ${operationId} is not yours to ${verb}`);
    }
    throw new VerbRefusal('unknown-operation', `${nodeId} is no agent that agent or team started, so ${operationId} names no start`, [...OPERATION_FORMS]);
};

const byTask = (task: Task, state: AgentState): Pick<AgentOperation, 'status' | 'detail'> => {
    if (task.status === 'open') {
        if (state === 'stopped') {
            return { status: 'cancelled', detail: 'its turn was stopped before it finished; its task stays open' };
        }
        return state === 'owed' ? { status: 'queued', detail: 'its start is owed and runs next' } : { status: 'running', detail: 'its task is open' };
    }
    if (task.status === 'done') {
        return { status: 'completed', detail: 'its task is done' };
    }
    return task.status === 'failed' ? { status: 'failed', detail: 'its task failed' } : { status: 'cancelled', detail: 'its task was cancelled' };
};

/* Without a task a start has done its part once the agent runs and its first turn is over. */
const byState = (state: AgentState): Pick<AgentOperation, 'status' | 'detail'> => {
    switch (state) {
        case 'owed':
            return { status: 'queued', detail: 'its start is owed and runs next' };
        case 'ended':
            return { status: 'cancelled', detail: 'it ended along with the node that opened it' };
        case 'stopped':
            return { status: 'cancelled', detail: 'its turn was stopped before it finished; the chat and its thread stay' };
        case 'running':
            return { status: 'running', detail: 'it is working' };
        case 'needs-you':
            return { status: 'running', detail: 'it waits on a person' };
        case 'idle':
            return {
                status: 'completed',
                detail: 'the start is done: its first turn ended and it waits for a message; whether the work itself is done, it does not say'
            };
        case 'exited':
            return { status: 'completed', detail: 'its CLI exited' };
        case 'error':
            return { status: 'failed', detail: 'its last turn ended in an error' };
        case 'none':
            return { status: 'failed', detail: 'nothing runs in it: its start gave up, or the machine restarted and no client has shown it since' };
    }
};

/* How the whole stands: going on while any part is, else failed when any part failed. */
const overall = (statuses: readonly OperationStatus[]): OperationStatus => {
    const going = statuses.filter((status) => status === 'queued' || status === 'running');
    if (going.length > 0) {
        return going.every((status) => status === 'queued') ? 'queued' : 'running';
    }
    if (statuses.includes('failed')) {
        return 'failed';
    }
    return statuses.every((status) => status === 'cancelled') ? 'cancelled' : 'completed';
};

type CancelLine = ActionOutput<'operation.cancel'>['operations'][number];

/* What a cancel does to one node a start made: only a chat's turn stops, and a terminal is left to a person. */
const cancelNode = async (agents: AgentStateHost, operationId: string, nodeId: string): Promise<CancelLine> => {
    const state = await agents.stateOf(nodeId);
    if (agents.cancelTurn(nodeId)) {
        return {
            operationId,
            status: 'cancelled',
            detail: `${nodeId}: its turn is told to stop, and operation get reads cancelled once it has; the chat, its thread and its task stay`
        };
    }
    if (state === 'owed') {
        return { operationId, status: 'left', detail: `${nodeId}: its start is owed and runs next, and a cancel does not take a start back` };
    }
    if (state === 'running' || state === 'needs-you') {
        return { operationId, status: 'left', detail: `${nodeId}: a terminal agent keeps running, since nothing sends it a signal a person did not press` };
    }
    return { operationId, status: 'over', detail: `${nodeId}: nothing runs in it now` };
};

export const operationActions: ActionHandlers<ServerActionContext> = {
    'operation.get': async ({ operationId }, { actor, context }) => {
        const { host } = context;
        const parsed = parseOperationId(operationId);
        if (!parsed) {
            throw new VerbRefusal('unknown-operation', `${operationId} is not an operation id; agent and team answer with one`, [...OPERATION_FORMS]);
        }
        const agents = host.agents;
        if (agents === undefined) {
            throw new VerbRefusal('no-operations', 'This machine cannot tell what runs in an agent node');
        }
        const rows: Array<AgentOperation | null> = [];
        for (const nodeId of parsed.nodeIds) {
            if (!isOwnStart(host, agents, actor.id, nodeId, operationId, 'follow')) {
                rows.push(null);
                continue;
            }
            const task = startTask(host, actor.id, nodeId);
            const placed = host.locate(nodeId) !== null;
            const state = await agents.stateOf(nodeId);
            const read = task !== undefined ? byTask(task, state) : placed ? byState(state) : { status: 'cancelled' as const, detail: 'the node is gone' };
            rows.push({ nodeId, ...read, taskId: task?.id ?? null });
        }
        if (rows.every((row) => row === null)) {
            throw new VerbRefusal(
                'unknown-operation',
                `${operationId} names no agent you opened that is still here; a deleted node without a task is forgotten`,
                [...OPERATION_FORMS]
            );
        }
        const known = rows.map(
            (row, index) => row ?? { nodeId: parsed.nodeIds[index]!, status: 'cancelled' as const, taskId: null, detail: 'the node is gone' }
        );
        return {
            output: { operationId, action: parsed.action, status: overall(known.map((row) => row.status)), agents: known }
        };
    },
    'operation.cancel': async ({ operationId }, { actor, context }) => {
        const { host } = context;
        const parsed = operationId === null ? null : parseOperationId(operationId);
        if (operationId === null || !parsed) {
            throw new VerbRefusal('unknown-operation', `${operationId ?? 'nothing'} is not an operation of yours; agent and team answer with one`, [
                ...OPERATION_FORMS
            ]);
        }
        const agents = host.agents;
        if (agents === undefined) {
            throw new VerbRefusal('no-operations', 'This machine cannot tell what runs in an agent node');
        }
        const lines: CancelLine[] = [];
        let yours = 0;
        for (const nodeId of parsed.nodeIds) {
            const placed = host.locate(nodeId) !== null;
            if (!isOwnStart(host, agents, actor.id, nodeId, operationId, 'cancel')) {
                lines.push({ operationId, status: 'over', detail: `${nodeId}: the node is gone` });
                continue;
            }
            yours += 1;
            lines.push(placed ? await cancelNode(agents, operationId, nodeId) : { operationId, status: 'over', detail: `${nodeId}: the node is gone` });
        }
        if (yours === 0) {
            throw new VerbRefusal(
                'unknown-operation',
                `${operationId} names no agent you opened that is still here; a deleted node without a task is forgotten`,
                [...OPERATION_FORMS]
            );
        }
        return { output: { operations: lines } };
    }
};
