import { chatSink, useChats, type ChatsById, type ChatSink, type ChatStatuses } from '@adecore/agents-react/state';
import type { AgentStatus } from '@ruimte/contracts';
import { nodeWork, type AgentWork } from '@/state/agent-work';
import { childWaitOf, openChildTasks, type ChildWait } from '@/state/delegation';
import { endpointKey, useEndpointOfNode } from '@/state/keys';
import { nodeStatus, useSessions, type SessionsByKey, type StatusOf } from '@/state/sessions';
import { useTasks } from '@/state/tasks';
import { useEndpointId } from './current-endpoint';

/* The sink of one daemon's chat client: it hands over node ids, this puts them under its machine. */
export function chatSinkFor(endpointId: string): ChatSink {
    return chatSink((chatId) => endpointKey(endpointId, chatId));
}

interface ChatRows {
    byKey: ChatsById;
    statusByKey: ChatStatuses;
}

/* Whether a thread got or lost a row, or a chat's status moved. A streamed word grows `items` and changes neither. */
function chatThreadsChanged(state: ChatRows, previous: ChatRows): boolean {
    if (state.statusByKey !== previous.statusByKey) {
        return true;
    }
    if (state.byKey === previous.byKey) {
        return false;
    }
    const keys = Object.keys(state.byKey);
    if (keys.length !== Object.keys(previous.byKey).length) {
        return true;
    }
    return keys.some((key) => {
        const now = state.byKey[key];
        const before = previous.byKey[key];
        return before === undefined || now.structure !== before.structure || now.order !== before.order || now.waitingBefore !== before.waitingBefore;
    });
}

/* Calls back only when a chat's status moved, never for a streamed word, for what reads the status alone. */
export function subscribeChatStatuses(listener: () => void): () => void {
    return useChats.subscribe((state, previous) => {
        if (state.statusByKey !== previous.statusByKey) {
            listener();
        }
    });
}

/* Calls back when a status moved or a thread got or lost a row, for what reads a thread's requests or turns. */
export function subscribeChatThreads(listener: () => void): () => void {
    return useChats.subscribe((state, previous) => {
        if (chatThreadsChanged(state, previous)) {
            listener();
        }
    });
}

/* One node's rows from both stores, subscribed to each, so a change in either re-renders. */
function useNodeRows(node: StatusOf): [SessionsByKey, ChatStatuses, string] {
    const endpointId = useEndpointId();
    const key = endpointKey(useEndpointOfNode(node, endpointId), node.id);
    const session = useSessions((s) => s.byKey[key]);
    const chat = useChats((s) => s.statusByKey[key]);
    return [session ? { [key]: session } : {}, chat ? { [key]: chat } : {}, endpointId];
}

export function useNodeStatus(node: StatusOf): AgentStatus | undefined {
    return nodeStatus(node, ...useNodeRows(node));
}

/* What the agent in this node works on. A terminal's status cannot say, since it reads running while a shell sits at its prompt. */
export function useNodeWork(node: StatusOf): AgentWork | null {
    const [sessions, chats, endpointId] = useNodeRows(node);
    const machine = useEndpointOfNode(node, endpointId);
    const tasks = useTasks((s) => s.byEndpoint[machine]);

    return nodeWork(node, sessions, chats, endpointId, tasks);
}

/* The child agent of this node that waits on a person or on a limit. Only a node with an open task reads every chat. */
export function useChildWait(node: StatusOf): ChildWait | null {
    const endpointId = useEndpointId();
    const machine = useEndpointOfNode(node, endpointId);
    const tasks = useTasks((s) => s.byEndpoint[machine]);
    const delegates = (node.kind === 'chat' || node.kind === 'design') && openChildTasks(tasks, node.id).length > 0;
    const sessions = useSessions((s) => (delegates ? s.byKey : NO_ROWS));
    const chats = useChats((s) => (delegates ? s.statusByKey : NO_ROWS));

    return delegates ? childWaitOf(node.id, tasks, sessions, chats, machine) : null;
}

const NO_ROWS = {};
