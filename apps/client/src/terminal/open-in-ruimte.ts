import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { canvasOfNode, NODE_SIZE } from '@/state/canvas';
import { windowWorkspace } from '@/state/window';

export function openTerminalLinkInRuimte(uri: string, endpointId: string, sourceId?: string): boolean {
    // Login terminals can belong to a different machine, or have no project to put a browser in.
    if (windowWorkspace()?.connection.endpointId !== endpointId) {
        return false;
    }
    const canvas = sourceId ? canvasOfNode(sourceId)?.getState() : undefined;
    const source = sourceId ? canvas?.nodes[sourceId] : undefined;
    if (source && canvas?.viewId) {
        const size = NODE_SIZE.browser;
        void createNodeAction('browser', {
            viewId: canvas.viewId,
            url: uri,
            at: { x: source.x + source.w + 32 + size.w / 2, y: source.y + size.h / 2 }
        });
    } else {
        void createViewAction('browser', { url: uri });
    }
    return true;
}
