import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { browserRegistry } from '@/browser/registry';
import { canvasOfNode, NODE_SIZE } from '@/state/canvas';
import { currentEndpointId, splitKey } from '@/state/keys';

// The room between a page and the one a link opened beside it, the same step a duplicate takes.
const BESIDE_PX = 32;

/*
 * "Open link in new browser node" from a page's own context menu. The shell knows the page that
 * asked only by its web contents id, so the choice of where the link lands is made here. On a
 * canvas the new node sits beside the one the link came from, and a page that is a view of its own
 * opens another view, since there is no canvas under it to sit on.
 */
export function openLinkBeside(url: string, webContentsId: number): void {
    const sourceKey = browserRegistry.keyOfContents(webContentsId);
    const reference = sourceKey === null ? null : splitKey(sourceKey);
    if (reference !== null && reference.endpointId !== currentEndpointId()) {
        return;
    }
    const browserOwner = sourceKey === null ? undefined : browserRegistry.ownerOf(sourceKey);
    const canvas = reference === null ? undefined : canvasOfNode(reference.id)?.getState();
    const source = reference === null ? undefined : canvas?.nodes[reference.id];
    if (!source) {
        void createViewAction('browser', { url, browserOwner });
        return;
    }
    const size = NODE_SIZE.browser;
    void createNodeAction('browser', {
        viewId: canvas!.viewId!,
        url,
        browserOwner,
        at: { x: source.x + source.w + BESIDE_PX + size.w / 2, y: source.y + size.h / 2 }
    });
}
