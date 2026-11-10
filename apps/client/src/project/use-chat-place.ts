import type { ChatPlace } from '@adecore/agents-react';
import { focusPromptStart } from '@adecore/agents-react/prompts';
import { focusNodeAction } from '@/action-port/person-actions';
import { revealNode, showView } from '@/project/views';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { forkOriginIn } from '@/state/fork-origin';
import { useChildTask } from '@/state/tasks';
import { useViewNodes } from '@/state/view-nodes';
import { bringPromptToFront } from '@/surface/canvas/prompt-stack';

/* Puts the keyboard on the card a chat's composer shows, where the prompts of its children are answered too. */
function focusComposerCard(chatId: string): void {
    const body = document.querySelector<HTMLElement>(`[data-chat-body="${CSS.escape(chatId)}"]`);

    body?.querySelector('.prompt-card')?.scrollIntoView({ block: 'nearest' });
    focusPromptStart(body);
}

/*
 * The camera to a chat node on this canvas, over to the canvas of a node elsewhere, or the chat's
 * own view: what a fork's pill and a summary's note lead to. A child an agent opened outside every
 * view is answered from its parent, so its place is the card there.
 */
export function useChatPlace(chatId: string): ChatPlace {
    const shape = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.shape ?? null);
    const title = useViewNodes((views, nodesOf) => forkOriginIn(views, nodesOf, chatId)?.title ?? null);
    const onThisCanvas = useCanvas((s) => chatId !== '' && s.nodes[chatId] !== undefined);
    const canvasStore = useCanvasStore();
    const task = useChildTask(chatId);
    const waitsInParent = title === null && task !== null && task.status === 'open';
    const parentOnThisCanvas = useCanvas((s) => task !== null && s.nodes[task.parentId] !== undefined);

    if (waitsInParent) {
        return {
            title: task.title,
            go: () => {
                if (parentOnThisCanvas) {
                    bringPromptToFront(chatId);
                } else {
                    focusComposerCard(task.parentId);
                }
            }
        };
    }

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
