import type { AgentStatus } from '@ruimte/contracts';
import { chatSink, useChats, type ChatSink, type ChatStatuses } from '@adecore/agents-react/state/chats';
import { nodeWork, type AgentWork } from '@/state/agent-work';
import { endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type SessionsByKey, type StatusOf } from '@/state/sessions';

/* The sink of one daemon's chat client: it hands over node ids, this puts them under its machine. */
export function chatSinkFor(endpointId: string): ChatSink {
    return chatSink((chatId) => endpointKey(endpointId, chatId));
}

/* One node's rows from both stores, subscribed to each, so a change in either re-renders. */
function useNodeRows(node: StatusOf): [SessionsByKey, ChatStatuses, string] {
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, node.id);
    const session = useSessions((s) => s.byKey[key]);
    const chat = useChats((s) => s.statusByKey[key]);
    return [session ? { [key]: session } : {}, chat ? { [key]: chat } : {}, endpointId];
}

export function useNodeStatus(node: StatusOf): AgentStatus | undefined {
    return nodeStatus(node, ...useNodeRows(node));
}

/* What the agent in this node works on. A terminal's status cannot say, since it reads running while a shell sits at its prompt. */
export function useNodeWork(node: StatusOf): AgentWork | null {
    return nodeWork(node, ...useNodeRows(node));
}
