import type { ChatPlace } from '@adecore/agents-react';
import { focusNodeAction } from '@/action-port/person-actions';
import { forkOriginIn } from '@/chat/fork-origin';
import { revealNode, showView } from '@/project/views';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useViewNodes } from '@/state/view-nodes';

/*
 * The camera to a chat node on this canvas, over to the canvas of a node elsewhere, or the chat's
 * own view: what a fork's pill and a summary's note lead to.
 */
export function useChatPlace(chatId: string): ChatPlace {
    const shape = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.shape ?? null);
    const title = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.title ?? null);
    const onThisCanvas = useCanvas((s) => chatId !== '' && s.nodes[chatId] !== undefined);
    const canvasStore = useCanvasStore();
    const go = (): void => {
        if (onThisCanvas) {
            focusNodeAction(canvasStore.getState().viewId, chatId);
        } else if (shape === 'view') {
            showView(chatId);
        } else if (shape === 'node') {
            revealNode(chatId);
        }
    };
    return { title, go };
}
