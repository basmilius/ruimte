import { isCanvasView } from '@ruimte/contracts';
import { focusedCanvas, maximizedNodeOf } from '@/state/canvas';
import { DEFAULT_CHAT_TEXT_SIZE, useChatTextSizes, type ChatTextSize } from '@/state/chat-text-size';
import { currentEndpointId } from '@/state/current-endpoint';
import { shownChatOfNode } from '@/state/design-chat';
import { activeViewOf, useDocument } from '@/state/document';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { useUi } from '@/state/ui';
import { focusedEditor } from '@/surface/panels/focused-editor';
import { focusedChatComposerKey, keyboardChatKey } from './focused-chat';

/* Selection alone leaves +/- with the canvas; a maximized chat is the reading surface even on its frame. */
function chatTextTarget(): string | null {
    if (focusedEditor() !== null || useUi.getState().settings.open) {
        return null;
    }

    const keyboard = keyboardChatKey();

    if (keyboard !== null) {
        return keyboard;
    }

    const view = activeViewOf(useDocument.getState());

    if (view === null) {
        return null;
    }

    if (!isCanvasView(view)) {
        return focusedChatComposerKey();
    }

    const canvas = focusedCanvas().getState();
    const maximized = maximizedNodeOf(canvas);
    const node = maximized === null || canvas.bodyFocusId !== null ? undefined : canvas.nodes[maximized];
    const chat = node === undefined ? null : shownChatOfNode(node);

    return chat === null || node === undefined ? null : endpointKey(endpointOfNode(node, currentEndpointId()), chat);
}

export function focusedChatTextSize(): ChatTextSize | null {
    const key = chatTextTarget();

    return key === null ? null : (useChatTextSizes.getState().byKey[key] ?? DEFAULT_CHAT_TEXT_SIZE);
}

export function stepChatTextSize(direction: -1 | 1): boolean {
    const key = chatTextTarget();

    if (key === null) {
        return false;
    }

    useChatTextSizes.getState().step(key, direction);

    return true;
}

export function resetChatTextSize(): boolean {
    const key = chatTextTarget();

    if (key === null) {
        return false;
    }

    useChatTextSizes.getState().reset(key);

    return true;
}
