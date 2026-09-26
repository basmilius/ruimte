import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import type { ForkShape } from '@ruimte/agents-react/chat/logic/fork';

/* Where a chat stands in the project: a node on a canvas or a view of its own, under the name it goes by. */
export interface ForkOrigin {
    shape: ForkShape;
    title: string;
}

export const forkOriginIn = (views: readonly ProjectView[], chatId: string): ForkOrigin | null => {
    for (const view of views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return { shape: 'view', title: view.name };
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === chatId && candidate.kind === 'chat');
            if (node) {
                return { shape: 'node', title: node.title };
            }
        }
    }
    return null;
};
