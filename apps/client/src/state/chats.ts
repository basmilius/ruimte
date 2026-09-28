import type { AgentStatus } from '@ruimte/contracts';
import { chatSink, useChats, type ChatSink } from '@ruimte/agents-react/state/chats';
import { nodeWorking } from '@/state/agent-work';
import { endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';

/* The sink of one daemon's chat client: it hands over node ids, this puts them under its machine. */
export const chatSinkFor = (endpointId: string): ChatSink => chatSink((chatId) => endpointKey(endpointId, chatId));

/* Status of one node, read from whichever store owns it. Both hooks subscribe, so a change in either re-renders. */
export const useNodeStatus = (node: StatusOf): AgentStatus | undefined => {
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, node.id);
    const session = useSessions((s) => s.byKey[key]);
    const chat = useChats((s) => s.statusByKey[key]);
    return nodeStatus(node, session ? { [key]: session } : {}, chat ? { [key]: chat } : {}, endpointId);
};

/* Whether an agent is mid-turn in this node. A terminal's status cannot say, since it reads running while a shell sits at its prompt. */
export const useNodeWorking = (node: StatusOf): boolean => {
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, node.id);
    const session = useSessions((s) => s.byKey[key]);
    const chat = useChats((s) => s.statusByKey[key]);
    return nodeWorking(node, session ? { [key]: session } : {}, chat ? { [key]: chat } : {}, endpointId);
};
