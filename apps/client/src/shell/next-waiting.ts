import { chatNameOf } from '@ruimte/contracts';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { useDocument } from '@/state/document';
import { nextWaiting, projectWaiting, type Waiting } from '@/state/waiting';

let visited: Waiting | null = null;

/*
 * Goes to what has waited on a person longest in the open project, the way a click on its
 * notification does, and on to the next one when pressed again. False when nothing waits.
 */
export function revealNextWaiting(): boolean {
    const target = nextWaiting(projectWaiting(), visited);
    if (target === null) {
        return false;
    }
    visited = target;
    revealNode(target.id);
    bringPromptToFront(target.id);
    return true;
}

/* The name of what the next press goes to, for the palette row; null when nothing waits. */
export function nextWaitingTitle(): string | null {
    const target = nextWaiting(projectWaiting(), visited);
    return target === null ? null : (projectNodes().find((node) => node.id === target.id)?.title ?? chatNameOf(useDocument.getState().views, target.id));
}
