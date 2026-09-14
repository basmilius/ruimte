import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronDown, Globe, MessageSquare, Plus, Terminal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { carriesFiles, carriesPaths, dropEffectFor, dropPoints, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { GRID, intersects, snapToGrid, toWorld, type Point, type Rect } from '@/canvas/math';
import { isSpaceDown } from '@/canvas/canvas-shortcuts';
import { NODE_SIZE, useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { showFileOnCanvas } from '@/project/views';
import { addAgentNodeAtCenter, addNodeAtCenter } from '@/shell/commands';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { CanvasMenuPopup } from '@/canvas/CanvasMenu';
import { EdgeLayer } from '@/canvas/EdgeLayer';
import { NodeFrame } from '@/canvas/NodeFrame';
import { TextElementView } from '@/canvas/TextElementView';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { isInFloatingLayer } from '@/ui/floating';
import { Icon } from '@/ui/Icon';
import { ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { Kbd } from '@/ui/Kbd';
import { isModHeld } from '@/ui/shortcut';
import { isApplePlatform } from '@/desktop/bridge';

type Gesture =
    | { kind: 'pan'; last: Point }
    | { kind: 'box'; origin: Point; current: Point; additive: boolean }
    | { kind: 'move'; start: Point; applied: Point; moved: boolean }
    | { kind: 'link'; from: string }
    | {
          kind: 'resize';
          nodeId: string;
          edge: string;
          start: Point;
          rect: Rect;
      };

const ZOOM_SETTLE_MS = 160;
/* World units between two files dropped at once: a node's own width and a gutter, so the second one
   stands beside the first instead of over it. */
const DROP_STEP = NODE_SIZE.file.w + 24;
const MIN_NODE = { w: 240, h: 160 };

/* Snapped rect for a resize from `edge`, keeping the opposite edge fixed. */
const resizedRect = (rect: Rect, edge: string, dx: number, dy: number): Rect => {
    const r = { ...rect };
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    if (edge.includes('e')) {
        r.w = Math.max(MIN_NODE.w, snapToGrid(rect.w + dx));
    }
    if (edge.includes('s')) {
        r.h = Math.max(MIN_NODE.h, snapToGrid(rect.h + dy));
    }
    if (edge.includes('w')) {
        r.x = Math.min(snapToGrid(rect.x + dx), right - MIN_NODE.w);
        r.w = right - r.x;
    }
    if (edge.includes('n')) {
        r.y = Math.min(snapToGrid(rect.y + dy), bottom - MIN_NODE.h);
        r.h = bottom - r.y;
    }
    return r;
};

export function Canvas() {
    /* The editor of this cell. Everything below a render (an effect, a gesture, a menu) goes through
       it, because the cell this canvas is drawn in is not always the cell that has the focus. */
    const canvasStore = useCanvasStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    const zoomTimer = useRef<number | null>(null);
    const zoomAnchor = useRef<Point>({ x: 0, y: 0 });
    const zoomMoved = useRef(false);
    const [box, setBox] = useState<Rect | null>(null);
    const [activeGesture, setActiveGesture] = useState<Gesture['kind'] | null>(null);
    /* A drag carrying files is hanging over the canvas, which the border says so nobody has to
       guess whether letting go here does anything. */
    const [dropping, setDropping] = useState(false);
    const endpointId = useEndpointId();
    // Where the last right-click landed, in world units, so the menu's "add here" knows where.
    const menuPoint = useRef<Point>({ x: 0, y: 0 });

    const { camera, order, texts, mode, locks, aiming } = useCanvas(
        useShallow((s) => ({
            camera: s.camera,
            order: s.order,
            texts: s.texts,
            mode: s.mode,
            locks: s.locks,
            aiming: s.linkDraft?.aiming === true
        }))
    );
    const textIds = useMemo(() => Object.keys(texts), [texts]);
    // Groups paint under everything else, whatever their place in the stacking order.
    const nodes = useCanvas((s) => s.nodes);
    const renderOrder = useMemo(
        () => [...order.filter((id) => nodes[id]?.kind === 'group'), ...order.filter((id) => nodes[id]?.kind !== 'group')],
        [order, nodes]
    );

    // The pages park outside this transform and may not swallow the pointer mid-gesture.
    useEffect(() => {
        canvasStore.getState().setGesturing(activeGesture !== null);
    }, [activeGesture, canvasStore]);

    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        /* The store decides what to do with the size, which is where a waiting camera move runs. */
        const observer = new ResizeObserver(([entry]) => {
            canvasStore.getState().setViewport({
                w: entry.contentRect.width,
                h: entry.contentRect.height
            });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [canvasStore]);

    /* Chromium reports a trackpad pinch as a wheel with Ctrl held on every platform, so Ctrl always
       zooms and Cmd joins it on macOS; the Windows key never does. */
    const wheelZooms = (e: WheelEvent): boolean => e.ctrlKey || isModHeld(e, isApplePlatform());

    /* React registers wheel listeners as passive, so preventDefault there cannot stop the
       browser's own pinch zoom. The canvas needs a native, non-passive listener. */
    useEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        const onWheel = (e: WheelEvent): void => {
            const s = canvasStore.getState();
            const target = e.target as HTMLElement;
            const ownerId = target.closest('[data-node-body]')?.closest('[data-node-id]')?.getAttribute('data-node-id');
            const isZoom = wheelZooms(e);
            /* A focused node owns the wheel inside its body. Pinch is always the camera's. */
            if (!isZoom && s.mode.kind === 'node' && ownerId === s.mode.nodeId) {
                return;
            }
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const anchor = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            if (isZoom) {
                if (s.locks.zoom) {
                    return;
                }
                s.zoomAt(Math.exp(-e.deltaY * 0.01), anchor);
                zoomAnchor.current = anchor;
                zoomMoved.current = true;
                if (zoomTimer.current) {
                    window.clearTimeout(zoomTimer.current);
                }
                zoomTimer.current = window.setTimeout(() => {
                    if (zoomMoved.current) {
                        canvasStore.getState().settleZoom(zoomAnchor.current);
                        zoomMoved.current = false;
                    }
                }, ZOOM_SETTLE_MS);
                return;
            }
            if (!s.locks.pan) {
                s.panBy(-e.deltaX, -e.deltaY);
            }
        };
        /* Outside the canvas (sidebar, dock) a pinch must not zoom the page either. */
        const swallowPinch = (e: WheelEvent): void => {
            if (wheelZooms(e) && !el.contains(e.target as Node)) {
                e.preventDefault();
            }
        };
        const swallowGesture = (e: Event): void => e.preventDefault();
        el.addEventListener('wheel', onWheel, { passive: false });
        document.addEventListener('wheel', swallowPinch, { passive: false });
        document.addEventListener('gesturestart', swallowGesture);
        document.addEventListener('gesturechange', swallowGesture);
        return () => {
            el.removeEventListener('wheel', onWheel);
            document.removeEventListener('wheel', swallowPinch);
            document.removeEventListener('gesturestart', swallowGesture);
            document.removeEventListener('gesturechange', swallowGesture);
        };
    }, [canvasStore]);

    const screenPoint = (e: { clientX: number; clientY: number }): Point => {
        const rect = rootRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /* A move only counts as a gesture once the pointer has moved: a plain click must not light the grid. */
    const startGesture = (g: Gesture, e: ReactPointerEvent): void => {
        gestureRef.current = g;
        if (g.kind !== 'move') {
            setActiveGesture(g.kind);
        }
        rootRef.current!.setPointerCapture(e.pointerId);
    };

    const onPointerDown = (e: ReactPointerEvent): void => {
        const target = e.target as HTMLElement;
        /* A popup portals out of its node but keeps bubbling here, so the checks below would read it
           as empty canvas. The press belongs to the popup, node mode and all. */
        if (isInFloatingLayer(target)) {
            return;
        }
        const s = canvasStore.getState();
        const point = screenPoint(e);
        const nodeId = target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null;
        const textId = target.closest<HTMLElement>('[data-text-id]')?.dataset.textId ?? null;

        if (e.button === 1 || (e.button === 0 && isSpaceDown())) {
            if (!s.locks.pan) {
                e.preventDefault();
                startGesture({ kind: 'pan', last: point }, e);
            }
            return;
        }
        if (e.button !== 0) {
            return;
        }

        // "Connect to..." is waiting for this click; on empty canvas it is a cancel.
        if (s.linkDraft?.aiming) {
            e.preventDefault();
            const targetId = nodeId ?? textId;
            if (targetId) {
                s.addEdge(s.linkDraft.from, targetId);
            }
            s.setLinkDraft(null);
            return;
        }

        const port = target.closest<HTMLElement>('[data-port]')?.dataset.port;
        if (port) {
            e.preventDefault();
            e.stopPropagation();
            s.setLinkDraft({ from: port, to: toWorld(s.camera, point) });
            startGesture({ kind: 'link', from: port }, e);
            return;
        }

        const resizeEdge = target.closest<HTMLElement>('[data-resize]')?.dataset.resize;
        if (resizeEdge && nodeId && !s.locks.resize) {
            e.preventDefault();
            s.setResizing(nodeId);
            startGesture(
                {
                    kind: 'resize',
                    nodeId,
                    edge: resizeEdge,
                    start: point,
                    rect: { ...s.nodes[nodeId] }
                },
                e
            );
            return;
        }

        if (nodeId) {
            const inBody = Boolean(target.closest('[data-node-body]'));
            const focused = s.mode.kind === 'node' && s.mode.nodeId === nodeId;
            if (inBody) {
                if (!focused) {
                    /* The mousedown that follows would move focus to body, after the node's own focus effect ran. */
                    e.preventDefault();
                    s.enterNode(nodeId);
                }
                return;
            }
            if (!s.selection.includes(nodeId)) {
                s.select([nodeId], e.shiftKey);
            } else if (e.shiftKey) {
                s.select(s.selection.filter((id) => id !== nodeId));
                return;
            }
            if (s.mode.kind === 'node') {
                s.exitNode();
            }
            s.bringToFront(nodeId);
            if (target.closest('button')) {
                return;
            }
            startGesture(
                {
                    kind: 'move',
                    start: point,
                    applied: { x: 0, y: 0 },
                    moved: false
                },
                e
            );
            return;
        }

        if (textId) {
            if (s.editingTextId === textId) {
                return;
            }
            if (!s.selection.includes(textId)) {
                s.select([textId], e.shiftKey);
            } else if (e.shiftKey) {
                s.select(s.selection.filter((id) => id !== textId));
                return;
            }
            if (s.mode.kind === 'node') {
                s.exitNode();
            }
            startGesture(
                {
                    kind: 'move',
                    start: point,
                    applied: { x: 0, y: 0 },
                    moved: false
                },
                e
            );
            return;
        }

        /* A button floating over the empty canvas (its "Add a terminal" action) must not lose its
           click to a box-select gesture that captures the pointer before the click fires. */
        if (target.closest('button')) {
            return;
        }
        if (s.mode.kind === 'node') {
            s.exitNode();
        }
        if (s.editingTextId) {
            s.setEditingText(null);
        }
        (document.activeElement as HTMLElement | null)?.blur();
        if (!e.shiftKey) {
            s.clearSelection();
        }
        startGesture(
            {
                kind: 'box',
                origin: point,
                current: point,
                additive: e.shiftKey
            },
            e
        );
    };

    const onPointerMove = (e: ReactPointerEvent): void => {
        const g = gestureRef.current;
        const s = canvasStore.getState();
        const point = screenPoint(e);
        if (!g) {
            if (s.linkDraft?.aiming) {
                s.setLinkDraft({ ...s.linkDraft, to: toWorld(s.camera, point) });
            }
            return;
        }
        switch (g.kind) {
            case 'pan':
                s.panBy(point.x - g.last.x, point.y - g.last.y);
                g.last = point;
                break;
            case 'move': {
                /* Snap the total offset, not each delta: positions stay on the grid throughout the drag. */
                const wanted = {
                    x: snapToGrid((point.x - g.start.x) / s.camera.zoom),
                    y: snapToGrid((point.y - g.start.y) / s.camera.zoom)
                };
                const dx = wanted.x - g.applied.x;
                const dy = wanted.y - g.applied.y;
                if (dx !== 0 || dy !== 0) {
                    const first = !g.moved;
                    if (first) {
                        g.moved = true;
                        setActiveGesture('move');
                    }
                    g.applied = wanted;
                    s.moveSelected(dx, dy, first);
                }
                break;
            }
            case 'box':
                g.current = point;
                setBox({
                    x: Math.min(g.origin.x, point.x),
                    y: Math.min(g.origin.y, point.y),
                    w: Math.abs(point.x - g.origin.x),
                    h: Math.abs(point.y - g.origin.y)
                });
                break;
            case 'resize':
                s.resizeNode(g.nodeId, resizedRect(g.rect, g.edge, (point.x - g.start.x) / s.camera.zoom, (point.y - g.start.y) / s.camera.zoom));
                break;
            case 'link':
                s.setLinkDraft({ from: g.from, to: toWorld(s.camera, point) });
                break;
        }
    };

    const onPointerUp = (e: ReactPointerEvent): void => {
        const g = gestureRef.current;
        gestureRef.current = null;
        setActiveGesture(null);
        if (!g) {
            return;
        }
        const s = canvasStore.getState();
        rootRef.current?.releasePointerCapture(e.pointerId);
        if (g.kind === 'box') {
            setBox(null);
            if (Math.abs(g.current.x - g.origin.x) > 3 || Math.abs(g.current.y - g.origin.y) > 3) {
                const a = toWorld(s.camera, g.origin);
                const b = toWorld(s.camera, g.current);
                const rect = {
                    x: Math.min(a.x, b.x),
                    y: Math.min(a.y, b.y),
                    w: Math.abs(b.x - a.x),
                    h: Math.abs(b.y - a.y)
                };
                if (g.additive) {
                    const hits = [
                        ...Object.values(s.nodes)
                            .filter((n) => intersects(n, rect))
                            .map((n) => n.id),
                        ...Object.values(s.texts)
                            .filter((t) => intersects({ x: t.x, y: t.y, w: t.size * 8, h: t.size * 1.4 }, rect))
                            .map((t) => t.id)
                    ];
                    s.select(hits, true);
                } else {
                    s.selectInRect(rect);
                }
            }
        } else if (g.kind === 'move' && g.moved) {
            s.settleMove();
        } else if (g.kind === 'resize') {
            s.setResizing(null);
        } else if (g.kind === 'link') {
            s.setLinkDraft(null);
            // The pointer is captured, so the target is whatever the canvas shows under it.
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const targetId = under?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? under?.closest<HTMLElement>('[data-text-id]')?.dataset.textId;
            if (targetId) {
                s.addEdge(g.from, targetId);
            }
        }
    };

    /* The canvas takes a file dragged out of the files panel or off a preview tab. The browser
       marks a drop as refused unless both handlers say otherwise, hence the preventDefault on the
       drag as well as on the drop. */
    const onDragOver = (e: React.DragEvent): void => {
        if (!carriesPaths(e.dataTransfer.types) && !carriesFiles(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed);
        setDropping(true);
    };

    const onDragLeave = (e: React.DragEvent): void => {
        // Moving over a node inside the canvas is a leave of the canvas as far as the event goes.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropping(false);
        }
    };

    const onDrop = (e: React.DragEvent): void => {
        setDropping(false);
        if (!carriesPaths(e.dataTransfer.types) && !carriesFiles(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        /* A drag out of the file manager is read here and not in `droppedPaths`: naming its files
           takes the desktop shell and the machine this project runs on, and it has to happen before
           the event is over. */
        const paths = carriesPaths(e.dataTransfer.types) ? droppedPaths(e.dataTransfer) : finderPaths(e.dataTransfer, endpointId);
        if (paths.length === 0) {
            return;
        }
        const at = toWorld(canvasStore.getState().camera, screenPoint(e));
        // Several files at once are several nodes in a row, so none of them lands on top of another.
        const points = dropPoints(at, paths.length, DROP_STEP);
        for (const [index, path] of paths.entries()) {
            showFileOnCanvas(path, points[index]!);
        }
    };

    const onDoubleClick = (e: React.MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-node-id]') || target.closest('[data-text-id]') || isInFloatingLayer(target)) {
            return;
        }
        const s = canvasStore.getState();
        s.addText(toWorld(s.camera, screenPoint(e)));
    };

    const gridStep = GRID * 3 * camera.zoom;

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                ref={rootRef}
                className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg bg-[image:radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)]"
                style={{
                    backgroundSize: `${gridStep}px ${gridStep}px`,
                    backgroundPosition: `${camera.x}px ${camera.y}px`,
                    // Space is tracked in a ref because a held key must not re-render the canvas; the cursor
                    // catches up on the next render, which the pointer move that follows always triggers.
                    // oxlint-disable-next-line react/refs
                    cursor: aiming ? 'crosshair' : activeGesture === 'pan' ? 'grabbing' : locks.pan ? undefined : isSpaceDown() ? 'grab' : undefined
                }}
                data-mode={mode.kind}
                data-gesture={activeGesture ?? undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={onDoubleClick}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onContextMenu={(e) => {
                    const s = canvasStore.getState();
                    menuPoint.current = toWorld(s.camera, screenPoint(e));
                }}
            >
                <div
                    className="absolute left-0 top-0 origin-top-left"
                    style={{
                        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`
                    }}
                >
                    <EdgeLayer />
                    {textIds.map((id) => (
                        <TextElementView key={id} id={id} />
                    ))}
                    {renderOrder.map((id) => (
                        <NodeFrame key={id} id={id} />
                    ))}
                </div>
                {renderOrder.length === 0 && textIds.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <EmptyState
                            className="pointer-events-auto"
                            action={
                                <Menu.Root>
                                    <Menu.Trigger render={<Button variant="secondary" />}>
                                        <Icon icon={Plus} size={12} /> Add
                                        <Icon icon={ChevronDown} size={12} />
                                    </Menu.Trigger>
                                    <Menu.Portal>
                                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={6} align="center">
                                            <Menu.Popup className="menu-popup">
                                                <Menu.Item className="menu-item" onClick={() => addNodeAtCenter('terminal')}>
                                                    <Icon icon={Terminal} size={14} /> Terminal <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                                                </Menu.Item>
                                                <Menu.Item className="menu-item" onClick={() => addNodeAtCenter('chat')}>
                                                    <Icon icon={MessageSquare} size={14} /> Chat <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                                                </Menu.Item>
                                                <AgentSubmenus onPick={(target, provider) => addAgentNodeAtCenter(target, provider)} />
                                                <Menu.Item className="menu-item" onClick={() => addNodeAtCenter('browser')}>
                                                    <Icon icon={Globe} size={14} /> Browser <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                                                </Menu.Item>
                                            </Menu.Popup>
                                        </Menu.Positioner>
                                    </Menu.Portal>
                                </Menu.Root>
                            }
                        >
                            Right-click anywhere to add a node, or press <Kbd shortcut={APP_SHORTCUTS.palette} />.
                        </EmptyState>
                    </div>
                )}
                {dropping && <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-accent ring-inset" aria-hidden />}
                {box && (
                    <div
                        className="pointer-events-none absolute rounded-sm border border-accent bg-accent/10"
                        style={{
                            left: box.x,
                            top: box.y,
                            width: box.w,
                            height: box.h
                        }}
                    />
                )}
            </ContextMenu.Trigger>
            <CanvasMenuPopup at={() => menuPoint.current} />
        </ContextMenu.Root>
    );
}
