import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { browserRegistry } from '@/clients/browser/registry';
import { canvasOfNode, type CanvasNode } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { splitKey } from '@/state/keys';
import { defaultNodeSize } from '@/state/node-size';

// The room between a node and the browser opened beside it, the same step a duplicate takes.
const BESIDE_PX = 32;

/* The center of a browser opened beside a node: to its right, top edges aligned. */
export function browserBeside(source: Pick<CanvasNode, 'x' | 'y' | 'w'>): { x: number; y: number } {
    const size = defaultNodeSize('browser');
    return { x: source.x + source.w + BESIDE_PX + size.w / 2, y: source.y + size.h / 2 };
}

/*
 * "Open link in new browser node" from a page's own context menu, which the shell names only by its
 * web contents id. On a canvas the new node sits beside the page; a page that is a view of its own
 * opens another view.
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
    void createNodeAction('browser', { viewId: canvas!.viewId!, url, browserOwner, at: browserBeside(source) });
}
