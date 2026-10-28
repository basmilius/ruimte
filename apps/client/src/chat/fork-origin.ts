import { chatHostOf, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import type { ForkShape } from '@adecore/agents-react/chat';
import type { NodesOfView } from '@/project/view-nodes';

/* Where a chat stands in the project: a node on a canvas or a view of its own, under the name it goes by. */
interface ForkOrigin {
    shape: ForkShape;
    title: string;
    /* The canvas a node is on; null for a chat view, which is no node of any canvas. */
    viewId: string | null;
}

export function forkOriginIn(
    views: readonly ProjectView[],
    nodesOf: NodesOfView<Pick<ProjectNode, 'id' | 'kind' | 'title'>>,
    chatId: string
): ForkOrigin | null {
    const host = chatHostOf(views, chatId);
    if (host !== null) {
        return { shape: 'view', title: host.chat.name, viewId: null };
    }
    for (const view of views) {
        const node = nodesOf(view).find((candidate) => candidate.id === chatId && candidate.kind === 'chat');
        if (node) {
            return { shape: 'node', title: node.title, viewId: view.id };
        }
    }
    return null;
}
