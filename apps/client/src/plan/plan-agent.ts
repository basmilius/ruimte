import { chatHostOf, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { agentName } from '@/plan/plan-view';
import { useChatRow } from '@adecore/agents-react/state';
import { useViewNodes, type NodesOfView } from '@/project/view-nodes';

/* The provider of a chat as the project names it, for a chat this client has not attached yet. */
function providerIn(views: readonly ProjectView[], nodesOf: NodesOfView<ProjectNode>, chatId: string): string | null {
    const host = chatHostOf(views, chatId);
    if (host !== null) {
        return host.chat.node.provider ?? null;
    }
    for (const view of views) {
        const node = nodesOf(view).find((candidate) => candidate.id === chatId);
        if (node) {
            return node.provider ?? null;
        }
    }
    return null;
}

/** The short name of the agent a plan's chat runs, from the live chat when this client has it. */
export function usePlanAgent(chatId: string): string {
    const liveProvider = useChatRow(chatId, (row) => row?.info.provider ?? null);
    const projectProvider = useViewNodes((views, nodesOf) => providerIn(views, nodesOf, chatId));
    return agentName(liveProvider ?? projectProvider);
}
