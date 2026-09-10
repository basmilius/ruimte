import { useEffect, useMemo, useRef } from 'react';
import { isCanvasView } from '@ruimte/contracts';
import { BrowserContextMenu } from '@/browser/BrowserContextMenu';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { GROUP_HEADER_PX, isNodeFocused, useCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';

// The browser toolbar sits under the frame's header, both above the page.
const TOOLBAR_PX = 37;

/*
 * Where every browser page lives, one host per node, for as long as the app runs. Chromium throws
 * a <webview> away the moment it leaves the DOM, so a host is never moved: the layer sits outside
 * the canvas transform and places each host in screen coordinates instead, scaled by the camera.
 * A node whose view is not on screen keeps its page, its scroll position and its session behind
 * `visibility: hidden`, and gets it back when its view mounts again. A browser view is the same
 * host over the whole column, which is why moving a page between the two costs it nothing.
 */
export function WebviewParking() {
    // Selecting the object and deriving the keys: a selector that builds an array loops forever.
    const byNodeId = useBrowser((s) => s.byNodeId);
    const ids = useMemo(() => Object.keys(byNodeId), [byNodeId]);
    const hosts = useRef(new Map<string, HTMLDivElement>());

    useEffect(() => {
        const place = (): void => {
            const { camera, nodes, hidden, mode, gesturing } = useCanvas.getState();
            const active = activeViewOf(useDocument.getState());
            // A view of its own is one page over the whole column; the canvas under it shows nothing.
            const filling = active && active.kind === 'browser' ? active.id : null;
            const onCanvas = active === null || isCanvasView(active);
            for (const [nodeId, host] of hosts.current) {
                if (nodeId === filling) {
                    host.style.visibility = 'visible';
                    host.style.pointerEvents = 'auto';
                    host.style.width = '100%';
                    host.style.height = '100%';
                    host.style.transform = 'none';
                    continue;
                }
                const node = nodes[nodeId];
                const shown = onCanvas && node !== undefined && node.kind === 'browser' && !hidden.has(nodeId);
                host.style.visibility = shown ? 'visible' : 'hidden';
                // Only a focused node hands the pointer to its page, and never while a gesture runs.
                host.style.pointerEvents = shown && isNodeFocused(mode, nodeId) && !gesturing ? 'auto' : 'none';
                if (!shown) {
                    continue;
                }
                const left = camera.x + node.x * camera.zoom;
                const top = camera.y + (node.y + GROUP_HEADER_PX + TOOLBAR_PX) * camera.zoom;
                host.style.width = `${node.w}px`;
                host.style.height = `${Math.max(1, node.h - GROUP_HEADER_PX - TOOLBAR_PX)}px`;
                host.style.transform = `translate(${left}px, ${top}px) scale(${camera.zoom})`;
            }
        };
        place();
        const offCanvas = useCanvas.subscribe(place);
        const offDocument = useDocument.subscribe(place);
        return () => {
            offCanvas();
            offDocument();
        };
    }, [ids]);

    const adopt = (nodeId: string, host: HTMLDivElement | null): void => {
        if (!host) {
            hosts.current.delete(nodeId);
            return;
        }
        hosts.current.set(nodeId, host);
        const element = browserRegistry.get(nodeId);
        if (element && element.parentElement !== host) {
            host.appendChild(element);
        }
    };

    return (
        <>
            {ids.length > 0 && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {ids.map((nodeId) => (
                        <div
                            key={nodeId}
                            ref={(host) => {
                                adopt(nodeId, host);
                            }}
                            className="absolute top-0 left-0 origin-top-left overflow-hidden bg-bg"
                            style={{ visibility: 'hidden' }}
                        />
                    ))}
                </div>
            )}
            {/* One menu for every page: a right-click in a page reaches the app as an event of the
                shell's, never as a click in this tree, so there is nothing per host to hang it on. */}
            <BrowserContextMenu />
        </>
    );
}
