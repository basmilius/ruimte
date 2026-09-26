import type { ChatPlace } from '@ruimte/agents-react/host';
import { focusNodeAction } from '@/actions/client-actions';
import { forkOriginIn } from '@/chat/fork-origin';
import { revealNode, showView } from '@/project/views';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';

/*
 * The camera to a chat node on this canvas, over to the canvas of a node elsewhere, or the chat's
 * own view: what a fork's pill and a summary's note lead to.
 */
export const useChatPlace = (chatId: string): ChatPlace => {
    const shape = useDocument((s) => forkOriginIn(s.views, chatId)?.shape ?? null);
    const documentTitle = useDocument((s) => forkOriginIn(s.views, chatId)?.title ?? null);
    // A node on this canvas carries its title live; the document catches up with the next save.
    const liveTitle = useCanvas((s) => (chatId === '' ? null : (s.nodes[chatId]?.title ?? null)));
    const canvasStore = useCanvasStore();
    const go = (): void => {
        if (liveTitle !== null) {
            focusNodeAction(canvasStore.getState().viewId, chatId);
        } else if (shape === 'view') {
            showView(chatId);
        } else if (shape === 'node') {
            revealNode(chatId);
        }
    };
    return { title: liveTitle ?? documentTitle, go };
};
