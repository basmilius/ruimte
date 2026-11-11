import { useChats } from '@adecore/agents-react/state';
import { isChatNode } from '@ruimte/contracts';
import { agentInfoOf, subagentsOf, type AgentInfo, type AgentTarget, type SubagentInfo } from '@/extensions/agent-info';
import { groupOf } from '@/extensions/slots';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { useTasks } from '@/state/tasks';

/*
 * The node of this id on the canvas a surface draws on, or a chat or terminal open as a view of its own. Each reads only
 * what its own agent hangs on, so a pet on one node draws nothing again when another node moves.
 */
function useTarget(id: string): AgentTarget | undefined {
    const node = useCanvas((state) => state.nodes[id]);
    const view = useDocument((state) => state.views.find((each) => each.id === id));

    if (node !== undefined) {
        return node;
    }

    return view?.kind === 'chat' || view?.kind === 'terminal' ? { ...view.node, id, kind: view.kind } : undefined;
}

export function useAgentOf(id: string): AgentInfo | null {
    const target = useTarget(id);
    const group = useCanvas((state) => (state.nodes[id] === undefined ? undefined : groupOf(state.nodes, id)));
    const endpointId = useEndpointId();
    const key = target === undefined ? null : endpointKey(endpointOfNode(target, endpointId), id);
    const session = useSessions((state) => (key === null ? undefined : state.byKey[key]));
    const chat = useChats((state) => (key === null ? undefined : state.statusByKey[key]));
    const snooze = useSnoozes((state) => (key === null ? undefined : state.byKey[key]));

    if (target === undefined || key === null) {
        return null;
    }

    const sources = {
        sessions: session === undefined ? {} : { [key]: session },
        chats: chat === undefined ? {} : { [key]: chat },
        snoozes: snooze === undefined ? {} : { [key]: snooze },
        endpointId
    };

    return agentInfoOf(target, group, sources) ?? null;
}

export function useSubagentsOf(id: string): SubagentInfo[] {
    const target = useTarget(id);
    const endpointId = useEndpointId();
    const machine = target === undefined ? endpointId : endpointOfNode(target, endpointId);
    // A design works as the chat under its own id; a terminal's sub-agents never reach a client.
    const key = target !== undefined && isChatNode(target) ? endpointKey(machine, id) : null;
    // A streamed word leaves the rows as they were, so only a change to one of them draws again.
    const structure = useChats((state) => (key === null ? undefined : state.byKey[key]?.structure));
    const order = useChats((state) => (key === null ? undefined : state.byKey[key]?.order));
    const before = useChats((state) => (key === null ? undefined : state.byKey[key]?.subagentsBefore));
    const tasks = useTasks((state) => state.byEndpoint[machine]);

    const row = structure === undefined || order === undefined ? undefined : { structure, order, ...(before === undefined ? {} : { subagentsBefore: before }) };

    return subagentsOf(row, tasks);
}
