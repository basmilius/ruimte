import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui-components/react/menu';
import { Braces, FileJson, MoreHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { GRID, type Point } from '@/canvas/math';
import { isApplePlatform } from '@/desktop/bridge';
import { DiagramDock } from '@/diagram/DiagramDock';
import { DiagramScene } from '@/diagram/DiagramScene';
import { copyDiagramJson, openDiagramJson } from '@/diagram/export';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { useProject } from '@/state/project';
import { isInFloatingLayer } from '@/ui/floating';
import { Icon } from '@/ui/Icon';
import { isModHeld } from '@/ui/shortcut';
import { Tooltip } from '@/ui/Tooltip';

const isChrome = (target: EventTarget | null): boolean =>
    isInFloatingLayer(target) || (target instanceof Element && target.closest('[data-diagram-chrome]') !== null);

/* The wheel settles on a whole percent this long after the last tick, as the canvas does. */
const ZOOM_SETTLE_MS = 160;

/*
 * What a diagram can be asked from the bar above it: the way to its JSON file. The zoom and the
 * exports are in the dock. Portaled into the bar of the view or the cell, so it reads the store of
 * the cell it belongs to.
 */
function DiagramControls({ viewId }: { viewId: string }) {
    const store = useDiagramStore();
    // A diagram nobody wrote has no file yet, so there is nothing to open.
    const written = useDiagram((s) => s.rev > 0);
    const hasFolder = useProject((s) => s.current?.folder != null);
    return (
        <Menu.Root>
            <Tooltip label="More" name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup min-w-52">
                        <Menu.Item className="menu-item" disabled={!hasFolder || !written} onClick={() => openDiagramJson(viewId)}>
                            <Icon icon={FileJson} size={14} /> Open the JSON file
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => void copyDiagramJson(store)}>
                            <Icon icon={Braces} size={14} /> Copy as JSON
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/*
 * A diagram on screen, as SVG in the DOM rather than on a canvas: a few dozen boxes with text in
 * them, where the DOM gives text rendering and selection for nothing. A person pans and zooms; the
 * graph itself is written, by hand in its file or by an agent.
 */
export function DiagramView({ id }: { id: string }) {
    /* The editor of this cell, never the focused one: two diagrams can stand side by side. */
    const store = useDiagramStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const zoomAnchor = useRef<Point>({ x: 0, y: 0 });
    const zoomTimer = useRef<number | null>(null);
    const panFrom = useRef<Point | null>(null);
    const [panning, setPanning] = useState(false);
    const camera = useDiagram(useShallow((s) => s.camera));
    const content = useDiagram((s) => s.content);
    const layout = useDiagram((s) => s.layout);
    const viewId = useDiagram((s) => s.viewId);
    const { host } = useFileToolbarSlot();

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            store.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, [store]);

    /* React makes wheel listeners passive, so the browser's own pinch zoom needs a native one. */
    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            const state = store.getState();
            // Chromium reports a trackpad pinch as a wheel with Ctrl held on every platform.
            if (!e.ctrlKey && !isModHeld(e, isApplePlatform())) {
                state.panBy(-e.deltaX, -e.deltaY);
                return;
            }
            const rect = root.getBoundingClientRect();
            const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            state.zoomAt(Math.exp(-e.deltaY * 0.01), anchor);
            zoomAnchor.current = anchor;
            if (zoomTimer.current !== null) {
                window.clearTimeout(zoomTimer.current);
            }
            zoomTimer.current = window.setTimeout(() => store.getState().settleZoom(zoomAnchor.current), ZOOM_SETTLE_MS);
        };
        root.addEventListener('wheel', onWheel, { passive: false });
        return () => root.removeEventListener('wheel', onWheel);
    }, [store]);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        // The controls are portaled into the bar and their menus into the body, yet React still
        // bubbles their presses through here; capturing the pointer for those would eat the click.
        // The dock sits inside the surface, so it is told apart by its mark.
        if ((e.button !== 0 && e.button !== 1) || !e.currentTarget.contains(e.target as Node) || isChrome(e.target)) {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        panFrom.current = { x: e.clientX, y: e.clientY };
        setPanning(true);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const from = panFrom.current;
        if (from === null) {
            return;
        }
        store.getState().panBy(e.clientX - from.x, e.clientY - from.y);
        panFrom.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (): void => {
        panFrom.current = null;
        setPanning(false);
    };

    const gridStep = GRID * 3 * camera.zoom;
    // Nothing to say until the file has been read, or an empty diagram would flash before a full one.
    const empty = viewId === id && content.nodes.length === 0;
    return (
        <div
            ref={rootRef}
            className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg bg-[image:radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)]"
            style={{
                backgroundSize: `${gridStep}px ${gridStep}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                cursor: panning ? 'grabbing' : 'grab'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            <svg
                className="absolute inset-0 h-full w-full select-none"
                role="img"
                aria-label={content.meta.title || 'Diagram'}
                style={{ fontFamily: 'var(--font-sans)' }}
            >
                <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
                    <DiagramScene content={content} layout={layout} />
                </g>
            </svg>
            {empty && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                    <p className="max-w-80 text-center text-sm text-text-muted">
                        This diagram is empty. Write its nodes and edges into its JSON file, or ask an agent to write it.
                    </p>
                </div>
            )}
            <DiagramDock />
            {host !== null && createPortal(<DiagramControls viewId={id} />, host)}
        </div>
    );
}
