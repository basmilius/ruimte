import { browserRegistry } from '@/browser/registry';
import { focusedCanvas, NODE_SIZE } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { splitKey } from '@/state/keys';

// The room between a page and the one a link opened beside it, the same step a duplicate takes.
const BESIDE_PX = 32;

/*
 * "Open link in new browser node" in a page's own context menu. The shell knows the page that asked
 * by its web contents id and nothing else, so the choice of where the link lands is made here: on a
 * canvas the new node sits beside the one the link came from, and a page that is a view of its own
 * opens another view, since there is no canvas under it to sit on.
 */
export const openLinkBeside = (url: string, webContentsId: number): void => {
    const sourceKey = browserRegistry.keyOfContents(webContentsId);
    const source = sourceKey === null ? undefined : focusedCanvas().getState().nodes[splitKey(sourceKey).id];
    if (!source) {
        useDocument.getState().addStandaloneView({ kind: 'browser', name: url, url });
        return;
    }
    const size = NODE_SIZE.browser;
    focusedCanvas()
        .getState()
        .addNode('browser', { x: source.x + source.w + BESIDE_PX + size.w / 2, y: source.y + size.h / 2 }, { url });
};
