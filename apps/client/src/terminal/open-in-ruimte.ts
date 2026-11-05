import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { browserBeside } from '@/browser/open-beside';
import { canvasOfNode } from '@/state/canvas';
import { windowWorkspace } from '@/transport/window';

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
