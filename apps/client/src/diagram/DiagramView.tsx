import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui-components/react/menu';
import { Braces, Check, Copy, Download, FileJson, Maximize, Minus, MoreHorizontal, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { DiagramContent, DrawingColor } from '@ruimte/contracts';
import {
    DEFAULT_EDGE_TONE,
    DEFAULT_GROUP_TONE,
    DEFAULT_NODE_TONE,
    GROUP_LABEL_BAND,
    SUB_SIZE,
    arrowHeadPath,
    dashOf,
    edgeLabelLinesOf,
    edgePath,
    shapePaths,
    textLinesOf,
    type DiagramLayout
} from '@ruimte/diagram';
import { activeZoomPreset, GRID, ZOOM_PRESETS, type Point } from '@/canvas/math';
import { isApplePlatform } from '@/desktop/bridge';
import { copyDiagramJson, copyDiagramPng, copyDiagramSvg, openDiagramJson, saveDiagramPng, saveDiagramSvg } from '@/diagram/export';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { useProject } from '@/state/project';
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { isModHeld } from '@/ui/shortcut';
import { Tooltip } from '@/ui/Tooltip';

/* The wheel settles on a whole percent this long after the last tick, as the canvas does. */
const ZOOM_SETTLE_MS = 160;

// The palette names resolve through the theme's own tokens, so a diagram follows light and dark.
const ink = (tone: DrawingColor): string => `var(--draw-${tone})`;
const paper = (tone: DrawingColor): string => `var(--draw-paper-${tone})`;

/* The graph as elements: the same layout and paths as the export, with the colors left to CSS. */
function DiagramScene({ content, layout }: { content: DiagramContent; layout: DiagramLayout }) {
    const nodes = new Map(content.nodes.map((node) => [node.id, node]));
    const groups = new Map(content.groups.map((group) => [group.id, group]));
    return (
        <>
            {layout.groups.map((box) => {
                const group = groups.get(box.id)!;
                const tone = ink(group.tone ?? DEFAULT_GROUP_TONE);
                return (
                    <g key={box.id}>
                        <rect
                            x={box.x}
                            y={box.y}
                            width={box.w}
                            height={box.h}
                            rx={12}
                            strokeWidth={1}
                            strokeDasharray="6 4"
                            style={{ fill: 'none', stroke: tone }}
                        />
                        <text x={box.labelBox.x} y={box.y + Math.round(GROUP_LABEL_BAND * 0.7)} fontSize={SUB_SIZE} fontWeight={600} style={{ fill: tone }}>
                            {group.label}
                        </text>
                    </g>
                );
            })}
            {layout.edges.map((route) => {
                const edge = content.edges[route.index]!;
                const tone = ink(edge.tone ?? DEFAULT_EDGE_TONE);
                return (
                    <g key={route.index}>
                        <path
                            d={edgePath(route.points)}
                            strokeWidth={2}
                            strokeLinejoin="round"
                            strokeDasharray={dashOf(edge.style) ?? undefined}
                            style={{ fill: 'none', stroke: tone }}
                        />
                        <path d={arrowHeadPath(route.points)} style={{ fill: tone }} />
                        {route.label &&
                            edgeLabelLinesOf(route.label).map((line, index) => (
                                <text
                                    key={index}
                                    x={line.x}
                                    y={line.y}
                                    fontSize={line.size}
                                    textAnchor="middle"
                                    strokeWidth={4}
                                    style={{ fill: tone, stroke: 'var(--canvas-bg)', paintOrder: 'stroke' }}
                                >
                                    {line.text}
                                </text>
                            ))}
                    </g>
                );
            })}
            {layout.nodes.map((box) => {
                const node = nodes.get(box.id)!;
                const tone = node.tone ?? DEFAULT_NODE_TONE;
                const paths = shapePaths(node.shape, box);
                return (
                    <g key={box.id}>
                        <path d={paths.body} strokeWidth={2} style={{ fill: paper(tone), stroke: ink(tone) }} />
                        {paths.detail && <path d={paths.detail} strokeWidth={2} style={{ fill: 'none', stroke: ink(tone) }} />}
                        {textLinesOf(box, node.shape).map((line, index) => (
                            <text
                                key={index}
                                x={line.x}
                                y={line.y}
                                fontSize={line.size}
                                fontWeight={line.bold ? 600 : undefined}
                                textAnchor="middle"
                                style={{ fill: ink(line.muted ? 'muted' : 'ink') }}
                            >
                                {line.text}
                            </text>
                        ))}
                    </g>
                );
            })}
        </>
    );
}

/*
 * What a diagram can be asked from the bar above it: the zoom, the way to the file and the exports.
 * Portaled into the bar of the view or the cell, so it reads the store of the cell it belongs to.
 */
function DiagramControls({ viewId }: { viewId: string }) {
    const store = useDiagramStore();
    const zoom = useDiagram((s) => s.camera.zoom);
    const empty = useDiagram((s) => s.content.nodes.length === 0);
    // A diagram nobody wrote has no file yet, so there is nothing to open.
    const written = useDiagram((s) => s.rev > 0);
    const hasFolder = useProject((s) => s.current?.folder != null);
    const preset = activeZoomPreset(zoom);
    return (
        <>
            <div className={BTN_GROUP}>
                <Tooltip label="Zoom out" name>
                    <button className="icon-btn h-7 w-7" onClick={() => store.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
                        <Icon icon={Minus} size={14} />
                    </button>
                </Tooltip>
                <Menu.Root>
                    <Tooltip label="Zoom presets">
                        <Menu.Trigger className="h-7 min-w-12 rounded-lg px-1 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text">
                            {Math.round(zoom * 100)}%
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="center">
                            <Menu.Popup className="menu-popup min-w-40">
                                <Menu.RadioGroup value={preset} onValueChange={(value: number) => store.getState().zoomTo(value / 100)}>
                                    {ZOOM_PRESETS.map((pct) => (
                                        <Menu.RadioItem key={pct} value={pct} className="menu-item">
                                            <span className="grid h-4 w-4 place-items-center">
                                                <Menu.RadioItemIndicator>
                                                    <Icon icon={Check} size={14} />
                                                </Menu.RadioItemIndicator>
                                            </span>
                                            <span className="tabular-nums">{pct}%</span>
                                        </Menu.RadioItem>
                                    ))}
                                </Menu.RadioGroup>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
                <Tooltip label="Zoom in" name>
                    <button className="icon-btn h-7 w-7" onClick={() => store.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                        <Icon icon={Plus} size={14} />
                    </button>
                </Tooltip>
                <Tooltip label="Fit everything" name>
                    <button className="icon-btn h-7 w-7" onClick={() => store.getState().fitAll()}>
                        <Icon icon={Maximize} size={14} />
                    </button>
                </Tooltip>
            </div>
            <Separator />
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
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <div className={MENU_LABEL}>Export the diagram</div>
                            <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDiagramPng(store)}>
                                <Icon icon={Copy} size={14} /> Copy as PNG
                            </Menu.Item>
                            <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDiagramPng(store)}>
                                <Icon icon={Download} size={14} /> Save PNG
                            </Menu.Item>
                            <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDiagramSvg(store)}>
                                <Icon icon={Copy} size={14} /> Copy as SVG
                            </Menu.Item>
                            <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDiagramSvg(store)}>
                                <Icon icon={Download} size={14} /> Save SVG
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </>
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
        if ((e.button !== 0 && e.button !== 1) || !e.currentTarget.contains(e.target as Node)) {
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
            {host !== null && createPortal(<DiagramControls viewId={id} />, host)}
        </div>
    );
}
