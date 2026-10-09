import { createNodeAction, createViewAction, linkNodesAction } from '@/actions/client-actions';
import { readNodeHost } from '@/nodes/node-host';
import { canvasOfNode, NODE_SIZE } from '@/state/canvas';
import { currentEndpointId } from '@/state/keys';
import { localBrowserRouteAvailable } from '@/browser/owner-route';

export async function openVerifiedSessionPort(id: string, url: string, machineId: string): Promise<void> {
    const host = readNodeHost(id);
    if (host?.kind !== 'terminal') {
        return;
    }
    if (!machineId || !localBrowserRouteAvailable(currentEndpointId(), url, machineId)) {
        throw new Error('The browser cannot reach the machine that owns this session port');
    }
    const canvas = canvasOfNode(id)?.getState();
    const source = canvas?.nodes[id];
    if (source && canvas?.viewId) {
        const size = NODE_SIZE.browser;
        const browserId = await createNodeAction('browser', {
            viewId: canvas.viewId,
            url,
            browserOwner: machineId,
            at: { x: source.x + source.w + 32 + size.w / 2, y: source.y + size.h / 2 }
        });
        if (!browserId) {
            throw new Error('Could not create the session browser');
        }
        await linkNodesAction(canvas.viewId, id, browserId);
    } else if (!host.onCanvas && !(await createViewAction('browser', { url, browserOwner: machineId }))) {
        throw new Error('Could not create the session browser view');
    }
}
