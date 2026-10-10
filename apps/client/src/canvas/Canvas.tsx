import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type RefObject
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { carriesFiles, carriesPaths, dropEffectFor, dropPoints, droppedPaths } from '@/canvas/drop';
import { gridTakesPath } from '@/shell/view-drag';
import { finderPaths } from '@/canvas/finder-drop';
import { GRID, snapToGrid, toWorld, type Point, type Rect } from '@/canvas/math';
import { isSpaceDown, subscribeSpacePan } from '@/canvas/space-pan';
import type { NodeSide } from '@ruimte/contracts';
import { boxScreenRect, boxWorldRect, startBoxSelection, type BoxSelection } from '@/canvas/box-selection';
import { alignmentGuides, gapGuides, type AlignmentGuide, type GapGuide } from '@/canvas/alignment-guides';
import { AlignmentGuides } from '@/canvas/AlignmentGuides';
import { editableGaps, gapOffsets, type EditableGap } from '@/canvas/editable-gaps';
import { GapHandles } from '@/canvas/GapHandles';
import { isGapModifierDown, subscribeGapModifier } from '@/canvas/gap-modifier';
import { registerGestureCancellation } from '@/canvas/gesture-cancel';
import { resizedRect } from '@/canvas/resize';
import { canLink } from '@/canvas/edge-lines';
import { resizedText } from '@/canvas/text-resize';
import { framePressHandsKeyboard } from '@/canvas/frame-press';
import { stackingOrder } from '@/canvas/stacking';
import { useWheelCamera } from '@/canvas/use-wheel-camera';
import { carriedByGroups, isNodeActive, maximizedNodeOf, NODE_SIZE, useCanvas, useCanvasStore, type CanvasState } from '@/state/canvas';
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
import { isInFloatingLayer, ContextMenu } from '@adecore/ui';

type Gesture =
    | { kind: 'pan'; last: Point }
    | ({ kind: 'box' } & BoxSelection)
    | { kind: 'move'; start: Point; applied: Point; moved: boolean }
    | { kind: 'gap'; gap: EditableGap; start: Point; moved: boolean }
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
function linkTargetUnder(clientX: number, clientY: number): { id: string; side?: NodeSide } | null {
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
}

function linkTargetAt(state: CanvasState, from: string, clientX: number, clientY: number): string | null {
    const id = linkTargetUnder(clientX, clientY)?.id ?? null;
    // A target that would take no line says nothing either.
    return id !== null && canLink(state.edges, from, id) ? id : null;
}

/* Hands the keyboard back to the page, so the node that had it stops answering keys. */
function blurActive(): void {
    return (document.activeElement as HTMLElement | null)?.blur();
}

type PointerCapture = { element: HTMLElement; pointerId: number };

function releaseCapture(captureRef: RefObject<PointerCapture | null>): void {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture?.element.hasPointerCapture(capture.pointerId)) {
        capture.element.releasePointerCapture(capture.pointerId);
    }
}

/* Shift on an item already selected takes it out again, which ends the press there. */
function selectPressed(s: CanvasState, id: string, additive: boolean): boolean {
    if (!s.selection.includes(id)) {
        s.select([id], additive);
        return false;
    }
    if (additive) {
        s.select(s.selection.filter((selected) => selected !== id));
        return true;
    }
    return false;
}

export function Canvas() {
    /* The editor of this cell. Everything below a render (an effect, a gesture, a menu) goes through
       it, because the cell this canvas is drawn in is not always the cell that has the focus. */
    const canvasStore = useCanvasStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    const captureRef = useRef<PointerCapture | null>(null);
    const wheelPanning = useRef(false);
    const spaceDown = useSyncExternalStore(subscribeSpacePan, isSpaceDown, () => false);
    const altDown = useSyncExternalStore(subscribeGapModifier, isGapModifierDown, () => false);
    const [gapEdit, setGapEdit] = useState<EditableGap[] | null>(null);
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
    const selection = useCanvas((s) => s.selection);
    const hidden = useCanvas((s) => s.hidden);
    const editable = useMemo(
        () =>
            gapEdit ??
            (!altDown || activeGesture !== null
                ? []
                : editableGaps(
                      Object.values(nodes).filter((node) => !hidden.has(node.id)),
                      selection
                  )),
        [nodes, hidden, selection, gapEdit, altDown, activeGesture]
    );
    /* The nodes are drawn in a fixed order and stacked with a z-index instead of being reordered in
       the DOM: moving an element takes it out of the document for a moment, and a body that had the
       keyboard loses it. Bringing a node to the front is a click in it, so that is exactly when it
       may not happen. */
    const drawIds = useMemo(() => [...order].sort(), [order]);
    const stacking = useMemo(() => stackingOrder(nodes, order), [order, nodes]);
    const maximizedId = useCanvas(maximizedNodeOf);

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
        const gesture = gestureRef.current;
        if (gesture?.kind === 'box') {
            setBox(boxScreenRect(gesture, camera));
        }
    }, [camera]);

    useEffect(() => {
        const cancel = (): void => {
            const gesture = gestureRef.current;
            gestureRef.current = null;
            if (gesture?.kind === 'box') {
                canvasStore.getState().select(gesture.previous);
            } else if (gesture?.kind === 'gap') {
                canvasStore.getState().endGapMove(true);
            } else if (gesture?.kind === 'move' && gesture.moved) {
                canvasStore.getState().settleMove();
            } else if (gesture?.kind === 'resize') {
                canvasStore.getState().setResizing(null);
            } else if (gesture?.kind === 'link') {
                canvasStore.getState().setLinkDraft(null);
            }
            releaseCapture(captureRef);
            canvasStore.getState().setGesturing(false);
            canvasStore.getState().setPanning(false);
            setActiveGesture(null);
            setBox(null);
            setGuides([]);
            setGaps([]);
            setGapEdit(null);
        };
        const offCancel = registerGestureCancellation(canvasStore, () => {
            if (gestureRef.current?.kind === 'box' || gestureRef.current?.kind === 'gap') {
                cancel();
                return true;
            }
            return false;
        });
        const lostCapture = (event: PointerEvent): void => {
            if (captureRef.current?.pointerId === event.pointerId && captureRef.current.element === event.target) {
                cancel();
            }
        };
        window.addEventListener('blur', cancel);
        window.addEventListener('lostpointercapture', lostCapture, true);
        return () => {
            offCancel();
            window.removeEventListener('blur', cancel);
            window.removeEventListener('lostpointercapture', lostCapture, true);
            cancel();
        };
    }, [canvasStore]);

    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        // A camera move waiting for the size runs in the store once it has one.
        const observer = new ResizeObserver(([entry]) => {
            canvasStore.getState().setViewport({
                w: entry.contentRect.width,
                h: entry.contentRect.height
            });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [canvasStore]);

    const flushWheel = useWheelCamera(rootRef, canvasStore, {
        // The maximized node stays where it is, so a camera moving behind it would only be lost.
        locks: () => {
            const s = canvasStore.getState();
            return maximizedNodeOf(s) === null ? s.locks : { pan: true, zoom: true };
        },
        ownsWheel: () => isSpaceDown() || gestureRef.current?.kind === 'pan' || gestureRef.current?.kind === 'box',
        onPan: (active) => {
            wheelPanning.current = active;
            canvasStore.getState().setPanning(active || gestureRef.current?.kind === 'pan');
        },
        /* The active node owns the wheel inside its body, and a pinch that reaches the canvas is the
           camera's. A pinch over a page that owns the pointer goes nowhere: Chromium applies the page
           scale only in the top-most widget, never in a `<webview>` guest, and the canvas never sees
           the event. Two fingers over a node nobody is working in pan the canvas. */
        defer: (e, zooming) => {
            const ownerId = (e.target as HTMLElement).closest('[data-node-body]')?.closest('[data-node-id]')?.getAttribute('data-node-id');
            const s = canvasStore.getState();
            return !zooming && ownerId !== null && ownerId !== undefined && (isNodeActive(s.bodyFocusId, ownerId) || maximizedNodeOf(s) === ownerId);
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
            canvasStore.getState().setGesturing(true);
        }
        // Capture on text itself so a click still targets it when the browser builds a double-click.
        const capture = (e.target as HTMLElement).closest<HTMLElement>('[data-text-resize], [data-text-id]') ?? rootRef.current!;
        captureRef.current = { element: capture, pointerId: e.pointerId };
        capture.setPointerCapture(e.pointerId);
    };

    const startMove = (point: Point, e: ReactPointerEvent): void => {
        startGesture({ kind: 'move', start: point, applied: { x: 0, y: 0 }, moved: false }, e);
    };

    const onPointerDownCapture = (e: ReactPointerEvent): void => {
        if (isInFloatingLayer(e.target) || (e.button !== 1 && (e.button !== 0 || !isSpaceDown()))) {
            return;
        }
        const state = canvasStore.getState();
        e.preventDefault();
        e.stopPropagation();
        if (!state.locks.pan && maximizedNodeOf(state) === null && gestureRef.current === null) {
            flushWheel();
            state.setPanning(true);
            startGesture({ kind: 'pan', last: screenPoint(e) }, e);
        }
    };

    const startGap = (gap: EditableGap, event: ReactPointerEvent): void => {
        if (event.button !== 0 || gestureRef.current !== null || maximizedNodeOf(canvasStore.getState()) !== null) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        flushWheel();
        const moving = gap.moves.map((move) => move.id);
        if (canvasStore.getState().beginGapMove(moving, gap.fixed)) {
            setGapEdit(editable);
            startGesture({ kind: 'gap', gap, start: toWorld(canvasStore.getState().camera, screenPoint(event)), moved: false }, event);
        }
    };

    /*
     * A press on a node's header puts the keyboard in its body (below); the browser would focus the
     * frame on mousedown right after and take it off again. The default is stopped here and not on the pointer
     * event, which would cost the header its click and the double-click that renames a node.
     */
    const onMouseDown = (e: ReactMouseEvent): void => {
        const target = e.target as HTMLElement;
        if (e.button === 1 || (e.button === 0 && isSpaceDown())) {
            e.preventDefault();
            return;
        }
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

        if (e.button !== 0) {
            return;
        }

        // "Connect to…" is waiting for this click; on empty canvas it is a cancel.
        if (s.linkDraft?.aiming) {
            e.preventDefault();
            if (nodeId) {
                s.addEdge(s.linkDraft.from, nodeId);
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
            if (selectPressed(s, nodeId, e.shiftKey)) {
                return;
            }
            s.bringToFront(nodeId);
            if (target.closest('button') || maximizedNodeOf(s) === nodeId) {
                return;
            }
            startMove(point, e);
            return;
        }

        if (textId) {
            if (s.editingTextId === textId) {
                return;
            }
            s.setBodyFocus(null);
            blurActive();
            if (!selectPressed(s, textId, e.shiftKey)) {
                startMove(point, e);
            }
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
        const previous = s.selection;
        if (!e.shiftKey) {
            s.clearSelection();
        }
        startGesture(
            {
                kind: 'box',
                ...startBoxSelection(s.camera, point, previous, e.shiftKey)
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
                setBox(boxScreenRect(g, s.camera));
                break;
            case 'gap': {
                const world = toWorld(s.camera, point);
                const delta = world[g.gap.axis] - g.start[g.gap.axis];
                if (g.moved || Math.abs(delta * s.camera.zoom) > 2) {
                    g.moved = true;
                    s.moveGapNodes(gapOffsets(g.gap, delta, e.shiftKey));
                }
                break;
            }
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
        flushWheel();
        const g = gestureRef.current;
        gestureRef.current = null;
        setActiveGesture(null);
        setGuides([]);
        setGaps([]);
        if (!g) {
            return;
        }
        const s = canvasStore.getState();
        releaseCapture(captureRef);
        s.setGesturing(false);
        s.setPanning(wheelPanning.current);
        if (g.kind === 'box') {
            setBox(null);
            g.current = screenPoint(e);
            const bounds = boxScreenRect(g, s.camera);
            if (e.type === 'pointercancel') {
                s.select(g.previous);
            } else if (bounds.w > 3 || bounds.h > 3) {
                s.selectInRect(boxWorldRect(g, s.camera), g.additive);
            }
        } else if (g.kind === 'move' && g.moved) {
            s.settleMove();
        } else if (g.kind === 'gap') {
            if (g.moved && e.type !== 'pointercancel') {
                const world = toWorld(s.camera, screenPoint(e));
                s.moveGapNodes(gapOffsets(g.gap, world[g.gap.axis] - g.start[g.gap.axis], e.shiftKey));
            }
            s.endGapMove(e.type === 'pointercancel');
            setGapEdit(null);
        } else if (g.kind === 'resize') {
            s.setResizing(null);
        } else if (g.kind === 'link') {
            s.setLinkDraft(null);
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
        const points = dropPoints(toWorld(canvasStore.getState().camera, screenPoint(e)), paths.length, DROP_STEP);
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
                    cursor: aiming ? 'crosshair' : activeGesture === 'pan' ? 'grabbing' : locks.pan ? undefined : spaceDown ? 'grab' : undefined
                }}
                data-gesture={activeGesture ?? undefined}
                data-canvas-surface
                tabIndex={-1}
                /* A file dropped here becomes a node, so the grid keeps the strip along the edge
                   and leaves the rest of the canvas to it (`shell/SplitGrid.tsx`). */
                data-takes-drop="middle"
                onMouseDown={onMouseDown}
                onPointerDownCapture={onPointerDownCapture}
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
                    {maximizedId === null && <EdgeLayer />}
                    {textIds.map((id) => (
                        <TextElementView key={id} id={id} />
                    ))}
                    {drawIds.map((id) => (
                        <NodeFrame key={id} id={id} z={id === maximizedId ? drawIds.length + 1 : (stacking[id] ?? 1)} />
                    ))}
                    {/* Over the nodes, so a port beside one is never covered by the node standing next to it. */}
                    {maximizedId === null && <PortHints rootRef={rootRef} />}
                </div>
                {drawIds.length === 0 && textIds.length === 0 && <EmptyCanvas />}
                {/* Over the pages, which the canvas itself cannot draw over. */}
                <CellOverlay slot="view">
                    <AlignmentGuides guides={guides} gaps={gaps} camera={camera} />
                    {maximizedId === null && !locks.move && (activeGesture === 'gap' || (!spaceDown && altDown && activeGesture === null)) && (
                        <GapHandles gaps={editable} nodes={nodes} camera={camera} onStart={startGap} />
                    )}
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
