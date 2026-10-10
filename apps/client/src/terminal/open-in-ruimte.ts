import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { canvasOfNode, NODE_SIZE, type CanvasNode } from '@/state/canvas';
import { windowWorkspace } from '@/state/window';

/* The center of a browser opened from a terminal: 32px to its right, top edges aligned. */
export function browserBeside(source: Pick<CanvasNode, 'x' | 'y' | 'w'>): { x: number; y: number } {
    const size = NODE_SIZE.browser;
    return { x: source.x + source.w + 32 + size.w / 2, y: source.y + size.h / 2 };
}

export function openTerminalLinkInRuimte(uri: string, endpointId: string, sourceId?: string): boolean {
    // Login terminals can belong to a different machine, or have no project to put a browser in.
    if (windowWorkspace()?.connection.endpointId !== endpointId) {
        return false;
    }
    const canvas = sourceId ? canvasOfNode(sourceId)?.getState() : undefined;
    const source = sourceId ? canvas?.nodes[sourceId] : undefined;
    if (source && canvas?.viewId) {
        void createNodeAction('browser', { viewId: canvas.viewId, url: uri, at: browserBeside(source) });
    } else {
        void createViewAction('browser', { url: uri });
    }
    return true;
}
