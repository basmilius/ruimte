import { useEffect, useMemo, useRef } from 'react';
import { BrowserContextMenu } from '@/browser/BrowserContextMenu';
import { isDesktop } from '@/desktop/bridge';
import { focusCellOfView, watchGuestFocus } from '@/browser/guest-focus';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { nodesOverBrowsers } from '@/canvas/stacking';
import { pageClipPath, type PageHole } from '@/browser/page-clip';
import { cellElement, subscribeCells } from '@/shell/cell-rects';
import { viewIdsIn } from '@/shell/split';
import { GROUP_HEADER_PX, isNodeActive, liveCanvas, subscribeCanvases, type CanvasState } from '@/state/canvas';
import { splitKey } from '@/state/keys';
import { useDocument } from '@/state/document';

// The browser toolbar sits under the frame's header, both above the page.
const TOOLBAR_PX = 37;

/*
 * The open view a page belongs to, and whether it stands on its canvas. A node that was just added
 * is on its canvas before it is in the project's views, which are only rewritten when a view opens
 * or the project saves, so the living canvases are asked first: without that a new browser node
 * stays empty until the next view switch.
 */
const pageViewOf = (nodeId: string, open: readonly string[]): { viewId: string; onCanvas: boolean } | null => {
    for (const viewId of open) {
        if (liveCanvas(viewId)?.nodes[nodeId] !== undefined) {
            return { viewId, onCanvas: true };
        }
    }
    // A browser of its own is one page over a whole cell, and the node is the view.
    return open.includes(nodeId) ? { viewId: nodeId, onCanvas: false } : null;
};

interface Covering {
    nodes: unknown;
    order: unknown;
    hidden: unknown;
    selection: unknown;
    aimed: unknown;
    over: Record<string, PageHole[]>;
}

/* Answered once per canvas and kept until its nodes change, since it is asked again on every pan. */
const coveringCache = new Map<string, Covering>();

const coveringIn = (viewId: string, canvas: CanvasState): Record<string, PageHole[]> => {
    const aimed = canvas.linkDraft?.over ?? null;
    const cached = coveringCache.get(viewId);
    if (
        cached &&
        cached.nodes === canvas.nodes &&
        cached.order === canvas.order &&
        cached.hidden === canvas.hidden &&
        cached.selection === canvas.selection &&
        cached.aimed === aimed
    ) {
        return cached.over;
    }
    const ringed = new Set(aimed === null ? canvas.selection : [...canvas.selection, aimed]);
    const over = nodesOverBrowsers(canvas.nodes, canvas.order, canvas.hidden, ringed);
    coveringCache.set(viewId, { nodes: canvas.nodes, order: canvas.order, hidden: canvas.hidden, selection: canvas.selection, aimed, over });
    return over;
};

// Chromium discards a <webview> removed from the DOM, so hosts stay mounted and move in screen coordinates.
export function WebviewParking() {
    return isDesktop() ? <DesktopWebviewParking /> : null;
}

function DesktopWebviewParking() {
    // Selects the object and derives the keys separately, since a selector that builds a new array loops forever.
    const byKey = useBrowser((s) => s.byKey);
    const keys = useMemo(() => Object.keys(byKey), [byKey]);
    const hosts = useRef(new Map<string, HTMLDivElement>());
    const clips = useRef(new Map<string, HTMLDivElement>());
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        /*
         * Every page is placed against the cell of the view it belongs to, not the focused one. With
         * the views side by side, a page on a canvas two cells over still has to land on that canvas.
         * The clip box is the cell, so a node scrolled past the cell's edge is cut off by it rather
         * than drawn over the cell beside it.
         */
        const place = (): void => {
            const { layout } = useDocument.getState();
            const box = root.current?.getBoundingClientRect();
            const open = layout === null ? [] : viewIdsIn(layout);
            for (const [key, host] of hosts.current) {
                const nodeId = splitKey(key).id;
                const clip = clips.current.get(key);
                if (!clip || !box) {
                    continue;
                }
                const view = pageViewOf(nodeId, open);
                const cell = view === null ? null : cellElement(view.viewId);
                if (view === null || cell === null) {
                    // Both boxes are hidden here; a child marked visible would still show through a parent marked hidden.
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
                if (!view.onCanvas) {
                    host.dataset.square = '';
                    host.style.clipPath = '';
                    host.style.visibility = 'visible';
                    host.style.pointerEvents = 'auto';
                    host.style.width = '100%';
                    host.style.height = '100%';
                    host.style.transform = 'none';
                    continue;
                }
                delete host.dataset.square;
                const canvas = liveCanvas(view.viewId);
                const node = canvas?.nodes[nodeId];
                const shown = canvas !== null && node !== undefined && node.kind === 'browser' && !canvas.hidden.has(nodeId);
                host.style.visibility = shown ? 'visible' : 'hidden';
                /* Only the active node hands the pointer to its page, and never while a gesture runs.
                   A page that always took it would swallow the wheel, and panning over it would stop. */
                host.style.pointerEvents = shown && isNodeActive(canvas!.bodyFocusId, nodeId) && !canvas!.gesturing ? 'auto' : 'none';
                if (!shown) {
                    continue;
                }
                const { camera } = canvas!;
                const left = camera.x + node!.x * camera.zoom;
                const pageTop = node!.y + GROUP_HEADER_PX + TOOLBAR_PX;
                const top = camera.y + pageTop * camera.zoom;
                const width = node!.w;
                const height = Math.max(1, node!.h - GROUP_HEADER_PX - TOOLBAR_PX);
                host.style.width = `${width}px`;
                host.style.height = `${height}px`;
                host.style.transform = `translate(${left}px, ${top}px) scale(${camera.zoom})`;
                /* A page cannot go under a node, so it cuts a hole for every node standing on it and
                   the canvas under the layer shows through. The hole is in the page's own pixels,
                   which the camera's scale is applied to afterwards. */
                const covering = coveringIn(view.viewId, canvas!)[nodeId] ?? [];
                const holes = covering.map((hole) => ({ ...hole, x: hole.x - node!.x, y: hole.y - pageTop }));
                host.style.clipPath = pageClipPath(width, height, holes) ?? '';
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

    useEffect(() => {
        const offs: Array<() => void> = [];
        for (const key of keys) {
            const element = browserRegistry.get(key);
            if (!element) {
                continue;
            }
            offs.push(
                watchGuestFocus(element, () => {
                    const { layout } = useDocument.getState();
                    const view = pageViewOf(splitKey(key).id, layout === null ? [] : viewIdsIn(layout));
                    if (view !== null) {
                        focusCellOfView(view.viewId);
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
                        /* Two boxes per page. The outer one is the cell and clips; the inner one is
                           the node. The outer box never changes parent, so a page that moves to
                           another cell keeps its session instead of reloading. */
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
            {/* One menu for every page. A right-click in a page reaches the app as an event from the
                shell, not a click in this tree, so there is nothing per host to hang a menu on. */}
            <BrowserContextMenu />
        </>
    );
}
