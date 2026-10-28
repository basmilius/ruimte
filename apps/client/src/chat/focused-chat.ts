import { isCanvasView, isChatHostView, isDesignView, type ProjectView } from '@ruimte/contracts';
import { activeDesignChat, useDesignChat } from '@/design/design-chat';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';

/* The chat a view of its own shows: a chat view's, the one a design has in front, or none. */
function shownChatOf(view: ProjectView): string | null {
    if (isDesignView(view)) {
        return activeDesignChat(view, useDesignChat.getState().picked);
    }
    return isChatHostView(view) ? view.id : null;
}

/* The chat a command means: a chat view in the focused cell, or on its canvas the chat node with the keyboard, else the one selected alone. */
export function focusedChatId(): string | null {
    const view = activeViewOf(useDocument.getState());
    if (view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return shownChatOf(view);
    }
    const { bodyFocusId, selection, nodes } = focusedCanvas().getState();
    const id = bodyFocusId ?? (selection.length === 1 ? selection[0]! : null);
    return id !== null && nodes[id]?.kind === 'chat' ? id : null;
}

/* The key that chat's composer registers under, on the machine the chat runs on, so a menu row and its shortcut reach the same composer. */
export function focusedChatComposerKey(): string | null {
    const chat = focusedChatId();
    return chat === null ? null : endpointKey(endpointOfNodeId(chat), chat);
}

/*
 * The chat the keyboard is in, keyed on the machine it runs on: a chat view whose body has it, or the
 * chat node with it. Narrower than `focusedChatId`, since a chat that is only selected leaves the arrow
 * keys and Escape to the canvas.
 */
export function keyboardChatKey(): string | null {
    const documentState = useDocument.getState();
    const view = activeViewOf(documentState);
    if (view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        const chat = documentState.bodyFocused ? shownChatOf(view) : null;
        return chat === null ? null : endpointKey(endpointOfNodeId(chat), chat);
    }
    const { bodyFocusId, nodes } = focusedCanvas().getState();
    return bodyFocusId !== null && nodes[bodyFocusId]?.kind === 'chat' ? endpointKey(endpointOfNodeId(bodyFocusId), bodyFocusId) : null;
}
