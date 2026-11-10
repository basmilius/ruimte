import { isCanvasView } from '@ruimte/contracts';
import { browserRegistry } from '@/clients/browser/registry';
import type { KeyHandler } from '@/commands/behavior';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { windowWorkspace } from '@/workspace/window';

/* The page the keyboard means: a browser view in the focused cell, or the active browser node on its canvas. */
function focusedBrowserKey(): string | null {
    const endpointId = windowWorkspace()?.connection.endpointId ?? null;
    const view = activeViewOf(useDocument.getState());
    if (endpointId === null || view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return view.kind === 'browser' ? endpointKey(endpointId, view.id) : null;
    }
    const { bodyFocusId, nodes } = focusedCanvas().getState();

    return bodyFocusId !== null && nodes[bodyFocusId]?.kind === 'browser' ? endpointKey(endpointId, bodyFocusId) : null;
}

/*
 * Back and forward of a focused page. With the keyboard inside the page these never get here; the guest preload sends
 * them instead. Only a focused browser takes them, so a drawing keeps them for its order.
 */
export const BROWSER_KEY_HANDLERS: readonly KeyHandler[] = [
    (press) => {
        const forward = press.is(CANVAS_SHORTCUTS.browserForward);
        if (!forward && !press.is(CANVAS_SHORTCUTS.browserBack)) {
            return false;
        }
        const key = focusedBrowserKey();
        if (key === null) {
            return false;
        }
        press.event.preventDefault();
        if (forward) {
            browserRegistry.forward(key);
        } else {
            browserRegistry.back(key);
        }

        return true;
    }
];
