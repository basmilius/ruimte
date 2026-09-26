import { agentName } from '@/plan/plan-view';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { useDocument } from '@/state/document';

/* The provider of a chat as the project names it, for a chat this client has not attached yet. */
const providerIn = (views: ReturnType<typeof useDocument.getState>['views'], chatId: string): string | null => {
    for (const view of views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return view.node.provider ?? null;
        }
        if (view.kind === 'canvas') {
            const node = view.nodes.find((candidate) => candidate.id === chatId);
            if (node) {
                return node.provider ?? null;
            }
        }
    }
    return null;
};

/** The short name of the agent a plan's chat runs, from the live chat when this client has it. */
export function usePlanAgent(chatId: string): string {
    const liveProvider = useChatRow(chatId, (row) => row?.info.provider ?? null);
    const documentProvider = useDocument((s) => providerIn(s.views, chatId));
    return agentName(liveProvider ?? documentProvider);
}
