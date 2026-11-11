import type { ChatState, ChatStatuses } from '@adecore/agents-react/state';
import { extensionAgentStatus, type ChatItem, type ChatSubagentItem, type ExtensionAgentStatus } from '@ruimte/contracts';
import { nodeWork } from '@/state/agent-work';
import type { CanvasNode } from '@/state/canvas';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { nodeProvider, nodeStatus, nodeWaitAsk, type SessionsByKey, type StatusOf } from '@/state/sessions';
import { snoozeOf, type Snoozes } from '@/state/snooze';
import { childTask, type TasksById } from '@/state/tasks';

/* `AgentInfo` of `@ruimte/extension/client`: an agent as every surface of Ruimte shows it. */
export interface AgentInfo {
    provider: string;
    account: string | null;
    status: ExtensionAgentStatus;
    activity: 'turn' | 'delegating' | 'background' | null;
    snoozed: boolean;
    cwd: string | null;
    branch: string | null;
    worktree: string | null;
}

export interface SubagentInfo {
    status: 'running' | 'paused';
    node: { id: string } | null;
}

/* What an agent's info is read from, each from a hook in a render. */
export interface AgentSources {
    sessions: SessionsByKey;
    chats: ChatStatuses;
    snoozes: Snoozes;
    endpointId: string;
}

/* A node, or a chat or terminal open as a view of its own, which carries only its id, kind and what it was started with. */
export type AgentTarget = StatusOf & Partial<Pick<CanvasNode, 'provider' | 'account' | 'cwd'>>;

type Group = Pick<CanvasNode, 'worktree'> | undefined;

/*
 * The agent in a chat, a design or a terminal, or none: a terminal has one only once its CLI reported through its hooks,
 * since a shell running anything else is no agent. Working is `nodeWork` of the node's own agent, as its node shows it.
 */
export function agentInfoOf(node: AgentTarget, group: Group, { sessions, chats, snoozes, endpointId }: AgentSources): AgentInfo | undefined {
    if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'design') {
        return undefined;
    }

    const machine = endpointOfNode(node, endpointId);
    const cli = node.kind === 'terminal' ? sessions[endpointKey(machine, node.id)]?.agent : undefined;

    // A session says `null` once its CLI is gone, and has no agent at all before one reported.
    if (node.kind === 'terminal' && (cli === undefined || cli === null)) {
        return undefined;
    }

    const needsYou = nodeWaitAsk(node, sessions, chats, endpointId) !== null;
    // A chat this client has not heard from yet rests, as its node shows it, rather than reading as ended.
    const status = extensionAgentStatus(nodeStatus(node, sessions, chats, endpointId) ?? 'idle', needsYou);

    return {
        // A chat opened on the default stores no CLI; its thread says which one it runs on.
        provider: cli?.kind ?? nodeProvider(node, chats, endpointId) ?? 'claude',
        account: node.account ?? null,
        status,
        activity: status === 'needsYou' ? null : (nodeWork(node, sessions, chats, endpointId) ?? null),
        snoozed: status === 'needsYou' && snoozeOf(snoozes, machine, node.id) !== null,
        cwd: node.cwd ?? group?.worktree?.path ?? null,
        branch: group?.worktree?.branch ?? null,
        worktree: group?.worktree?.path ?? null
    };
}

const NONE: readonly string[] = [];

/*
 * The sub-agents of a chat at work, oldest first: the running rows of kind `subagent` in its thread, those from before the
 * page the client holds first. A task the chat gave that waits for a limit to lift is still a running row, as the pill over
 * the composer says "paused" for it.
 */
export function subagentsOf(row: Pick<ChatState, 'structure' | 'order' | 'subagentsBefore'> | undefined, tasks: TasksById | undefined): SubagentInfo[] {
    if (row === undefined) {
        return [];
    }

    return [...(row.subagentsBefore ?? NONE), ...row.order].flatMap((id) => {
        const item: ChatItem | undefined = row.structure[id];

        if (item?.kind !== 'subagent' || item.status !== 'running') {
            return [];
        }

        return [{ status: paused(item, tasks) ? 'paused' : 'running', node: item.childId === undefined ? null : { id: item.childId } }];
    });
}

function paused(item: ChatSubagentItem, tasks: TasksById | undefined): boolean {
    const task = item.origin === 'ruimte' && item.childId !== undefined ? childTask(tasks, item.childId) : null;

    return task?.status === 'open' && task.paused !== undefined;
}
