import { ToolRefusal } from '@adecore/agents/context';
import { chatHostOf, isCanvasView, isHiddenChatView, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
import { isExternalActor } from './external-caller.ts';
import { canvasNamed } from './host.ts';

/*
 * Whether the caller is an AI chat that is a view of its own. No line can run to a view, so such a
 * chat arranges a canvas the way a person does: it names the canvas with view, and every node there
 * is its to read and operate. A chat an inline edit runs in is no such chat.
 */
export function isChatView(content: Pick<ProjectContent, 'views'>, caller: string): boolean {
    // A client elsewhere has no node, so no line can run to it: it names a canvas with view, as a chat that is a view of its own does.
    if (isExternalActor(caller)) {
        return true;
    }

    const host = chatHostOf(content.views, caller);

    return host !== null && !isHiddenChatView(host.view);
}

/* The canvas that holds this id: as a node, a text, or the drawing or diagram view a node shows. */
export function canvasHolding(content: Pick<ProjectContent, 'views'>, id: string): ProjectCanvasView | undefined {
    return content.views
        .filter(isCanvasView)
        .find((view) => view.nodes.some((node) => node.id === id || node.viewId === id) || view.texts.some((text) => text.id === id));
}

/*
 * The canvas a chat view named with view to operate a node on it, or null when the call named none.
 * Only a chat view names one: a node on a canvas, or any other caller, operates a node over a line.
 */
export function arrangedCanvas(content: ProjectContent, caller: string, viewId: string | null | undefined): ProjectCanvasView | null {
    if (viewId == null) {
        return null;
    }
    if (!isChatView(content, caller)) {
        throw new ToolRefusal(
            'not-a-chat-view',
            'view lets a chat view operate the nodes of a canvas without a line; you are no chat view, so a line between you and the node is what lets you',
            ['see\tlink_new to <id>\tdraws that line from a node on the same canvas']
        );
    }
    return canvasNamed(content, viewId);
}

/* An id the call asked for on one canvas while it stands on another; the call again with that canvas is the answer. */
export function notOnView(id: string, holding: ProjectCanvasView, named: ProjectCanvasView, again: string): ToolRefusal {
    return new ToolRefusal('not-on-view', `${id} stands on ${holding.id}, not on ${named.id}`, [
        `see\t${again} view ${holding.id}\tnames the canvas it stands on`
    ]);
}

/* A chat view that asked for a node of a canvas without naming that canvas, which is what stands in for a line. */
export function viewRequired(id: string, holding: ProjectCanvasView, again: string): ToolRefusal {
    return new ToolRefusal(
        'view-required',
        `${id} stands on ${holding.id}; a chat view reads and operates the nodes of a canvas by naming it with view, since no line runs to a view`,
        [`see\t${again} view ${holding.id}\tnames the canvas it stands on`]
    );
}
