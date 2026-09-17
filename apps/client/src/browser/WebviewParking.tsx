import { useEffect, useMemo, useRef } from 'react';
import { isCanvasView } from '@ruimte/contracts';
import { BrowserContextMenu } from '@/browser/BrowserContextMenu';
import { focusCellOfView, watchGuestFocus } from '@/browser/guest-focus';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { cellElement, subscribeCells } from '@/shell/cell-rects';
import { viewIdsIn } from '@/shell/split';
import { GROUP_HEADER_PX, isNodeFocused, liveCanvas, subscribeCanvases } from '@/state/canvas';
import { splitKey } from '@/state/keys';
import { useDocument, viewOfNode } from '@/state/document';

// The browser toolbar sits under the frame's header, both above the page.
const TOOLBAR_PX = 37;

// Chromium discards a <webview> removed from the DOM, so hosts stay mounted and move in screen coordinates.
export function WebviewParking() {
    // Selecting the object and deriving the keys: a selector that builds an array loops forever.
    const byKey = useBrowser((s) => s.byKey);
    const keys = useMemo(() => Object.keys(byKey), [byKey]);
    const hosts = useRef(new Map<string, HTMLDivElement>());
    const clips = useRef(new Map<string, HTMLDivElement>());
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        /*
         * Every page is placed against the cell of the view it belongs to, not against the one that
         * has the focus: with the views side by side a page on a canvas two cells over still has to
         * land on that canvas. The clip box is the cell, so a node scrolled past the cell's edge is
         * cut off by it rather than drawn over the cell beside it.
         */
        const place = (): void => {
            const { views, layout } = useDocument.getState();
            const box = root.current?.getBoundingClientRect();
            const open = layout === null ? [] : viewIdsIn(layout);
            for (const [key, host] of hosts.current) {
                const nodeId = splitKey(key).id;
                const clip = clips.current.get(key);
                if (!clip || !box) {
                    continue;
                }
                const view = views.find((candidate) =>
                    isCanvasView(candidate) ? candidate.nodes.some((node) => node.id === nodeId) : candidate.id === nodeId
                );
                const cell = view && open.includes(view.id) ? cellElement(view.id) : null;
                if (!view || cell === null) {
                    // Both boxes: a child that says `visible` shows through a parent that says `hidden`.
                    clip.style.visibility = 'hidden';
                    host.style.visibility = 'hidden';
                    host.style.pointerEvents = 'none';
                    continue;
                }
                const rect = cell.getBoundingClientRect();
                clip.style.visibility = 'visible';
                clip.style.transform = `translate(${rect.left - box.left}px, ${rect.top - box.top}px)`;
                clip.style.width = `${rect.width}px`;
                clip.style.height = `${rect.height}px`;

                // A view of its own is one page over the whole cell; there is no canvas under it.
                if (!isCanvasView(view)) {
                    host.style.visibility = 'visible';
                    host.style.pointerEvents = 'auto';
                    host.style.width = '100%';
                    host.style.height = '100%';
                    host.style.transform = 'none';
                    continue;
                }
                const canvas = liveCanvas(view.id);
                const node = canvas?.nodes[nodeId];
                const shown = canvas !== null && node !== undefined && node.kind === 'browser' && !canvas.hidden.has(nodeId);
                host.style.visibility = shown ? 'visible' : 'hidden';
                // Only a focused node hands the pointer to its page, and never while a gesture runs.
                host.style.pointerEvents = shown && isNodeFocused(canvas!.mode, nodeId) && !canvas!.gesturing ? 'auto' : 'none';
                if (!shown) {
                    continue;
                }
                const { camera } = canvas!;
                const left = camera.x + node!.x * camera.zoom;
                const top = camera.y + (node!.y + GROUP_HEADER_PX + TOOLBAR_PX) * camera.zoom;
                host.style.width = `${node!.w}px`;
                host.style.height = `${Math.max(1, node!.h - GROUP_HEADER_PX - TOOLBAR_PX)}px`;
                host.style.transform = `translate(${left}px, ${top}px) scale(${camera.zoom})`;
            }
        };
        place();
        const offCanvas = subscribeCanvases(place);
        const offDocument = useDocument.subscribe(place);
        const offCells = subscribeCells(place);
        // The grid moves with the window as well, and a resize moves no state at all.
        window.addEventListener('resize', place);
        return () => {
            offCanvas();
            offDocument();
            offCells();
            window.removeEventListener('resize', place);
        };
    }, [keys]);

    /* A page taking the focus moves it to the cell of the view the page belongs to. */
    useEffect(() => {
        const offs: Array<() => void> = [];
        for (const key of keys) {
            const element = browserRegistry.get(key);
            if (!element) {
                continue;
            }
            offs.push(
                watchGuestFocus(element, () => {
                    const view = viewOfNode(useDocument.getState().views, splitKey(key).id);
                    if (view) {
                        focusCellOfView(view.id);
                    }
                })
            );
        }
        return () => {
            for (const off of offs) {
                off();
            }
        };
    }, [keys]);

    const adopt = (key: string, host: HTMLDivElement | null): void => {
        if (!host) {
            hosts.current.delete(key);
            return;
        }
        hosts.current.set(key, host);
        const element = browserRegistry.get(key);
        if (element && element.parentElement !== host) {
            host.appendChild(element);
        }
    };

    return (
        <>
            {keys.length > 0 && (
                <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
                    {keys.map((key) => (
                        /* Two boxes per page: the outer one is the cell, which clips, and the inner
                           one is the node inside it. The outer never changes parent, so a page that
                           moves to another cell keeps its session instead of reloading. */
                        <div
                            key={key}
                            ref={(clip) => {
                                if (clip) {
                                    clips.current.set(key, clip);
                                } else {
                                    clips.current.delete(key);
                                }
                            }}
                            className="absolute top-0 left-0 origin-top-left overflow-hidden"
                            style={{ visibility: 'hidden' }}
                        >
                            <div
                                ref={(host) => {
                                    adopt(key, host);
                                }}
                                className="browser-host absolute top-0 left-0 origin-top-left overflow-hidden bg-bg"
                                style={{ visibility: 'hidden' }}
                            />
                        </div>
                    ))}
                </div>
            )}
            {/* One menu for every page: a right-click in a page reaches the app as an event of the
                shell's, never as a click in this tree, so there is nothing per host to hang it on. */}
            <BrowserContextMenu />
        </>
    );
}
