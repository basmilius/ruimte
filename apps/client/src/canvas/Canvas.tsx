import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useShallow } from 'zustand/react/shallow';
import { carriesFiles, carriesPaths, dropEffectFor, dropPoints, droppedPaths } from '@/canvas/drop';
import { gridTakesPath } from '@/shell/view-drag';
import { finderPaths } from '@/canvas/finder-drop';
import { GRID, snapToGrid, toWorld, type Point, type Rect } from '@/canvas/math';
import { isSpaceDown } from '@/canvas/canvas-shortcuts';
import type { NodeSide } from '@ruimte/contracts';
import { rectFromPoints } from '@ruimte/drawing';
import { alignmentGuides, gapGuides, type AlignmentGuide, type GapGuide } from '@/canvas/alignment-guides';
import { AlignmentGuides } from '@/canvas/AlignmentGuides';
import { resizedRect } from '@/canvas/resize';
import { canLink } from '@/canvas/edge-lines';
import { resizedText } from '@/canvas/text-resize';
import { framePressHandsKeyboard } from '@/canvas/frame-press';
import { stackingOrder } from '@/canvas/stacking';
import { useWheelCamera } from '@/canvas/use-wheel-camera';
import { carriedByGroups, isNodeActive, NODE_SIZE, useCanvas, useCanvasStore, type CanvasState } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { createTextAction } from '@/actions/client-actions';
import { showFileOnCanvas } from '@/project/views';
import { CanvasMenuPopup } from '@/canvas/CanvasMenu';
import { EmptyCanvas } from '@/canvas/EmptyCanvas';
import { EdgeLayer } from '@/canvas/EdgeLayer';
import { PortHints } from '@/canvas/PortHints';
import { NodeFrame } from '@/canvas/NodeFrame';
import { TextElementView } from '@/canvas/TextElementView';
import { TextToolbar } from '@/canvas/TextToolbar';
import { CellOverlay } from '@/shell/CellOverlay';
import { isInFloatingLayer } from '@/ui/floating';

type Gesture =
    | { kind: 'pan'; last: Point }
    | { kind: 'box'; origin: Point; current: Point; additive: boolean }
    | { kind: 'move'; start: Point; applied: Point; moved: boolean }
    | { kind: 'text-resize'; textId: string; start: Point; x: number; width: number; side: 'left' | 'right'; moved: boolean }
    | { kind: 'link'; from: string; fromSide?: NodeSide }
    | {
          kind: 'resize';
          nodeId: string;
          edge: string;
          start: Point;
          rect: Rect;
      };

/* World units between two files dropped at once: a node's own width and a gutter, so the second one
   stands beside the first instead of over it. */
const DROP_STEP = NODE_SIZE.file.w + 24;

/*
 * What a line being drawn would land on: whatever the canvas shows under the pointer. The pointer is
 * captured by the canvas during a drag, so the element under it is looked up rather than read off
 * the event.
 */
const linkTargetUnder = (clientX: number, clientY: number): { id: string; side?: NodeSide } | null => {
    /* Everything under the pointer, not only the top one: a line drawn across another line must not
       lose the node it is over to the line's own hit area. */
    for (const element of document.elementsFromPoint(clientX, clientY)) {
        const port = element.closest<HTMLElement>('[data-port]');
        if (port?.dataset.port) {
            return { id: port.dataset.port, side: port.dataset.portSide as NodeSide | undefined };
        }
        const node = element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (node) {
            return { id: node };
        }
    }
    return null;
};

const linkTargetAt = (state: CanvasState, from: string, clientX: number, clientY: number): string | null => {
    const id = linkTargetUnder(clientX, clientY)?.id ?? null;
    // A target that would take no line says nothing either.
    return id !== null && canLink(state.edges, from, id) ? id : null;
};

/* Hands the keyboard back to the page, so the node that had it stops answering keys. */
const blurActive = (): void => (document.activeElement as HTMLElement | null)?.blur();

export function Canvas() {
    /* The editor of this cell. Everything below a render (an effect, a gesture, a menu) goes through
       it, because the cell this canvas is drawn in is not always the cell that has the focus. */
    const canvasStore = useCanvasStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    const [guides, setGuides] = useState<AlignmentGuide[]>([]);
    const [gaps, setGaps] = useState<GapGuide[]>([]);
    const [box, setBox] = useState<Rect | null>(null);
    const [activeGesture, setActiveGesture] = useState<Gesture['kind'] | null>(null);
    /* A drag carrying files is hanging over the canvas, which the border says so nobody has to
       guess whether letting go here does anything. */
    const [dropping, setDropping] = useState(false);
    const endpointId = useEndpointId();
    // Where the last right-click landed, in world units, so the menu's "add here" knows where.
    const menuPoint = useRef<Point>({ x: 0, y: 0 });

    const { camera, order, texts, locks, aiming } = useCanvas(
        useShallow((s) => ({
            camera: s.camera,
            order: s.order,
            texts: s.texts,
            locks: s.locks,
            aiming: s.linkDraft?.aiming === true
        }))
    );
    const textIds = useMemo(() => Object.keys(texts), [texts]);
    const nodes = useCanvas((s) => s.nodes);
    /* The nodes are drawn in a fixed order and stacked with a z-index instead of being reordered in
       the DOM: moving an element takes it out of the document for a moment, and a body that had the
       keyboard loses it. Bringing a node to the front is a click in it, so that is exactly when it
       may not happen. */
    const drawIds = useMemo(() => [...order].sort(), [order]);
    const stacking = useMemo(() => stackingOrder(nodes, order), [order, nodes]);

    useLayoutEffect(() => {
        const gesture = gestureRef.current;
        if (!gesture || (gesture.kind !== 'move' && gesture.kind !== 'resize' && gesture.kind !== 'text-resize')) {
            return;
        }
        if (gesture.kind === 'move' && !gesture.moved) {
            return;
        }
        const movingGroups = gesture.kind === 'move';
        const ids = gesture.kind === 'move' ? canvasStore.getState().selection : [gesture.kind === 'resize' ? gesture.nodeId : gesture.textId];
        const state = canvasStore.getState();
        const active = new Set(ids);
        const excluded = new Set([...ids, ...(movingGroups ? carriedByGroups(state.nodes, state.texts, ids) : [])]);
        const moving: Rect[] = [];
        const stationary: Rect[] = [];
        for (const node of Object.values(state.nodes)) {
            if (state.hidden.has(node.id)) {
                continue;
            }
            if (active.has(node.id)) {
                moving.push(node);
            } else if (!excluded.has(node.id)) {
                stationary.push(node);
            }
        }
        const root = rootRef.current!;
        const bounds = root.getBoundingClientRect();
        for (const element of root.querySelectorAll<HTMLElement>('[data-text-id]')) {
            const id = element.dataset.textId!;
            if (excluded.has(id) && !active.has(id)) {
                continue;
            }
            const rect = element.getBoundingClientRect();
            const origin = toWorld(state.camera, { x: rect.x - bounds.x, y: rect.y - bounds.y });
            const measured = { ...origin, w: rect.width / state.camera.zoom, h: rect.height / state.camera.zoom };
            if (active.has(id)) {
                moving.push(measured);
            } else {
                stationary.push(measured);
            }
        }
        setGuides(alignmentGuides(moving, stationary));
        setGaps(gapGuides(moving, stationary));
    }, [activeGesture, nodes, texts, camera, canvasStore]);

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

    useWheelCamera(rootRef, canvasStore, {
        locks: () => canvasStore.getState().locks,
        /* The active node owns the wheel inside its body, and a pinch that reaches the canvas is the
           camera's. A pinch over a page that owns the pointer goes nowhere: Chromium applies the page
           scale only in the top-most widget, never in a `<webview>` guest, and the canvas never sees
           the event. Two fingers over a node nobody is working in pan the canvas. */
        defer: (e, zooming) => {
            const ownerId = (e.target as HTMLElement).closest('[data-node-body]')?.closest('[data-node-id]')?.getAttribute('data-node-id');
            return !zooming && ownerId !== null && ownerId !== undefined && isNodeActive(canvasStore.getState().bodyFocusId, ownerId);
        }
    });

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
        // Capture on text itself so a click still targets it when the browser builds a double-click.
        const capture = (e.target as HTMLElement).closest<HTMLElement>('[data-text-resize], [data-text-id]') ?? rootRef.current!;
        capture.setPointerCapture(e.pointerId);
    };

    /*
     * A press on a node's header puts the keyboard in its body (below); the browser would focus the
     * frame on mousedown right after and take it off again. The default is stopped here and not on the pointer
     * event, which would cost the header its click and the double-click that renames a node.
     */
    const onMouseDown = (e: ReactMouseEvent): void => {
        const target = e.target as HTMLElement;
        if (e.button !== 0 || target.closest('button, input') || target.closest('[data-node-body]')) {
            return;
        }
        const nodeId = target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null;
        if (nodeId !== null && nodeId === canvasStore.getState().bodyFocusId) {
            e.preventDefault();
        }
    };

    const onPointerDown = (e: ReactPointerEvent): void => {
        const target = e.target as HTMLElement;
        /* A popup portals out of its node but keeps bubbling here, so the checks below would read it
           as empty canvas. The press belongs to the popup. */
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

        // "Connect to…" is waiting for this click; on empty canvas it is a cancel.
        if (s.linkDraft?.aiming) {
            e.preventDefault();
            const targetId = nodeId;
            if (targetId) {
                s.addEdge(s.linkDraft.from, targetId);
            }
            s.setLinkDraft(null);
            return;
        }

        const portElement = target.closest<HTMLElement>('[data-port]');
        const port = portElement?.dataset.port;
        if (port) {
            e.preventDefault();
            e.stopPropagation();
            // The port it starts on is the side the line keeps, however the two nodes move later.
            const fromSide = portElement?.dataset.portSide as NodeSide | undefined;
            s.setLinkDraft({ from: port, to: toWorld(s.camera, point), fromSide });
            startGesture({ kind: 'link', from: port, fromSide }, e);
            return;
        }

        const textResize = target.closest<HTMLElement>('[data-text-resize]')?.dataset.textResize;
        if (textId && (textResize === 'left' || textResize === 'right')) {
            e.preventDefault();
            if (!s.locks.resize) {
                const element = target.closest<HTMLElement>('[data-text-id]')!;
                s.select([textId]);
                startGesture(
                    {
                        kind: 'text-resize',
                        textId,
                        start: point,
                        x: s.texts[textId]!.x,
                        width: element.getBoundingClientRect().width / s.camera.zoom,
                        side: textResize,
                        moved: false
                    },
                    e
                );
            }
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
            if (target.closest('[data-node-body]')) {
                /* The press goes on into the body untouched: a click in a terminal, a thread or a page
                   is the person's. The canvas only notes that the keyboard is in this node now. */
                if (!isNodeActive(s.bodyFocusId, nodeId)) {
                    s.activateNode(nodeId);
                }
                return;
            }
            /* The header and the frame around the body: this press picks the node up and hands the
               keyboard to its content, the way a title bar does. */
            if (s.bodyFocusId !== nodeId) {
                blurActive();
                s.setBodyFocus(framePressHandsKeyboard(s.nodes[nodeId]?.kind, e.shiftKey) ? nodeId : null);
            }
            if (!s.selection.includes(nodeId)) {
                s.select([nodeId], e.shiftKey);
            } else if (e.shiftKey) {
                s.select(s.selection.filter((id) => id !== nodeId));
                return;
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
            s.setBodyFocus(null);
            blurActive();
            if (!s.selection.includes(textId)) {
                s.select([textId], e.shiftKey);
            } else if (e.shiftKey) {
                s.select(s.selection.filter((id) => id !== textId));
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

        /* A button floating over the empty canvas (its "Add a terminal" action) must not lose its
           click to a box-select gesture that captures the pointer before the click fires. */
        if (target.closest('button')) {
            return;
        }
        if (s.editingTextId) {
            s.setEditingText(null);
        }
        s.setBodyFocus(null);
        blurActive();
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
                s.setLinkDraft({
                    ...s.linkDraft,
                    to: toWorld(s.camera, point),
                    over: linkTargetAt(s, s.linkDraft.from, e.clientX, e.clientY) ?? undefined
                });
            }
            return;
        }
        switch (g.kind) {
            case 'pan':
                s.panBy(point.x - g.last.x, point.y - g.last.y);
                g.last = point;
                break;
            case 'move': {
                if (s.locks.move) {
                    break;
                }
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
            case 'text-resize': {
                const { x, maxWidth } = resizedText(g.x, g.width, g.side, (point.x - g.start.x) / s.camera.zoom, e.altKey);
                if ((maxWidth !== s.texts[g.textId]?.maxWidth || x !== s.texts[g.textId]?.x) && (g.moved || Math.abs(point.x - g.start.x) > 2)) {
                    s.resizeText(g.textId, x, maxWidth, !g.moved);
                    g.moved = true;
                }
                break;
            }
            case 'resize':
                s.resizeNode(
                    g.nodeId,
                    resizedRect(g.rect, g.edge, (point.x - g.start.x) / s.camera.zoom, (point.y - g.start.y) / s.camera.zoom, {
                        centered: e.altKey,
                        proportional: e.shiftKey
                    })
                );
                break;
            case 'link':
                s.setLinkDraft({
                    from: g.from,
                    to: toWorld(s.camera, point),
                    fromSide: g.fromSide,
                    over: linkTargetAt(s, g.from, e.clientX, e.clientY) ?? undefined
                });
                break;
        }
    };

    const onPointerUp = (e: ReactPointerEvent): void => {
        const g = gestureRef.current;
        gestureRef.current = null;
        setActiveGesture(null);
        setGuides([]);
        setGaps([]);
        if (!g) {
            return;
        }
        const s = canvasStore.getState();
        rootRef.current?.releasePointerCapture(e.pointerId);
        if (g.kind === 'box') {
            setBox(null);
            if (Math.abs(g.current.x - g.origin.x) > 3 || Math.abs(g.current.y - g.origin.y) > 3) {
                s.selectInRect(rectFromPoints(toWorld(s.camera, g.origin), toWorld(s.camera, g.current)), g.additive);
            }
        } else if (g.kind === 'move' && g.moved) {
            s.settleMove();
        } else if (g.kind === 'resize') {
            s.setResizing(null);
        } else if (g.kind === 'link') {
            s.setLinkDraft(null);
            // The pointer is captured, so the target is whatever the canvas shows under it.
            const target = linkTargetUnder(e.clientX, e.clientY);
            if (target) {
                s.addEdge(g.from, target.id, { fromSide: g.fromSide, toSide: target.side });
            }
        }
    };

    /* The canvas takes a file dragged out of the files panel or off a preview tab. The browser
       marks a drop as refused unless both handlers say otherwise, hence the preventDefault on the
       drag as well as on the drop. */
    const onDragOver = (e: React.DragEvent): void => {
        /* Along the edge of the cell the grid takes the file as a view of its own, so the canvas
           neither lights up nor makes a node of it (`shell/SplitGrid.tsx`). */
        if (gridTakesPath()) {
            setDropping(false);
            return;
        }
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
        if (gridTakesPath() || (!carriesPaths(e.dataTransfer.types) && !carriesFiles(e.dataTransfer.types))) {
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
            void showFileOnCanvas(path, points[index]!);
        }
    };

    const onDoubleClick = (e: React.MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-node-id]') || target.closest('[data-text-id]') || isInFloatingLayer(target)) {
            return;
        }
        createTextAction(toWorld(canvasStore.getState().camera, screenPoint(e)));
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
                data-gesture={activeGesture ?? undefined}
                /* A file dropped here becomes a node, so the grid keeps the strip along the edge
                   and leaves the rest of the canvas to it (`shell/SplitGrid.tsx`). */
                data-takes-drop="middle"
                onMouseDown={onMouseDown}
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
                    {drawIds.map((id) => (
                        <NodeFrame key={id} id={id} z={stacking[id] ?? 1} />
                    ))}
                    {/* Over the nodes, so a port beside one is never covered by the node standing next to it. */}
                    <PortHints rootRef={rootRef} />
                </div>
                {drawIds.length === 0 && textIds.length === 0 && <EmptyCanvas />}
                {/* Over the pages, which the canvas itself cannot draw over. */}
                <CellOverlay slot="view">
                    <AlignmentGuides guides={guides} gaps={gaps} camera={camera} />
                    <TextToolbar />
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
                </CellOverlay>
            </ContextMenu.Trigger>
            <CanvasMenuPopup at={() => menuPoint.current} />
        </ContextMenu.Root>
    );
}
