import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DrawingElement } from '@ruimte/contracts';
import { boundsOfElements, elementAt, rectFromPoints, resizeRect, scaleElement, type Point, type Rect, type ResizeHandle } from '@ruimte/drawing';
import { GRID, toWorld } from '@/canvas/math';
import { DrawingDock } from '@/drawing/DrawingDock';
import { DrawingOverlay } from '@/drawing/DrawingOverlay';
import { loadDrawingFont } from '@/drawing/fonts';
import {
    DRAG_THRESHOLD,
    DEFAULT_NOTE,
    DEFAULT_SHAPE,
    constrainAngle,
    lineElement,
    scaledTextSize,
    settleStroke,
    shapeElement,
    shapeRect,
    snapPoint,
    textElement
} from '@/drawing/gestures';
import { applyCamera, clearPathCache, fitTextBox, paintElements, paintOptions } from '@/drawing/paint';
import { useDrawingKeys } from '@/drawing/use-drawing-keys';
import { useDocument } from '@/state/document';
import { nextId } from '@/state/canvas';
import { isWritten, newSeed, useDrawing, useDrawingStore } from '@/state/drawing';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { isInFloatingLayer } from '@/ui/floating';

/*
 * The dock sits over the surface and its menus portal out to <body>, where React still routes their
 * events through the surface. A press on either is a button, never the start of a gesture: without
 * this the marquee below clears the selection and captures the pointer, so the click never lands.
 */
const isChrome = (target: EventTarget | null): boolean =>
    isInFloatingLayer(target) || (target instanceof Element && target.closest('[data-drawing-chrome]') !== null);

/* How far from a line or an outline a click still lands on it, before the zoom is taken out. */
const HIT_TOLERANCE = 10;

/*
 * What one press started. Everything a drag can be lives here rather than in the store: it is over
 * when the pointer lets go, and nothing outside this view has any use for it.
 */
type Gesture =
    | { kind: 'pan'; last: Point }
    | { kind: 'draft'; start: Point }
    | { kind: 'marquee'; origin: Point; additive: boolean }
    | { kind: 'move'; last: Point; first: boolean }
    | { kind: 'resize'; handle: ResizeHandle; from: Rect; elements: DrawingElement[]; first: boolean }
    | { kind: 'rotate'; center: Point; id: string; first: boolean }
    | { kind: 'erase' };

/* The wheel settles on a whole percent this long after the last tick, as the canvas does. */
const ZOOM_SETTLE_MS = 160;

/*
 * A drawing on screen: one canvas for what is drawn, a second for the stroke in the making, and a
 * DOM layer above them for the handles and the text editor, which stay whole pixels at any zoom.
 */
export function DrawingView({ id }: { id: string }) {
    /* The editor of this cell. Two drawings can stand side by side and only one of them has the
       focus, so every read, write and subscription below a render goes through this store. */
    const drawingStore = useDrawingStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<HTMLCanvasElement>(null);
    const draftRef = useRef<HTMLCanvasElement>(null);
    const zoomAnchor = useRef({ x: 0, y: 0 });
    const zoomTimer = useRef<number | null>(null);
    const spaceRef = useRef(false);
    const camera = useDrawing(useShallow((s) => s.camera));
    const tool = useDrawing((s) => s.tool);
    const theme = useTheme((s) => s.resolved);
    const [fontReady, setFontReady] = useState(false);
    const [marquee, setMarquee] = useState<Rect | null>(null);
    const gesture = useRef<Gesture | null>(null);
    const [gestureKind, setGestureKind] = useState<Gesture['kind'] | null>(null);
    const snapSetting = useSettings((s) => s.drawingSnap);
    /* One keyboard: the tools answer for the drawing in the focused cell, not for one beside it. */
    useDrawingKeys(
        drawingStore,
        useDocument((s) => s.activeViewId === id)
    );

    // The hand of a drawing arrives with the first one that is opened, never with the app.
    useEffect(() => {
        let alive = true;
        void loadDrawingFont().then(() => {
            if (alive) {
                setFontReady(true);
            }
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => clearPathCache, [id]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            drawingStore.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, [drawingStore]);

    /* Paints on every change of what is drawn, of the camera or of the theme, once per frame. */
    useEffect(() => {
        let frame = 0;
        const draw = (): void => {
            frame = 0;
            const scene = sceneRef.current;
            const draft = draftRef.current;
            const ctx = scene?.getContext('2d');
            const draftCtx = draft?.getContext('2d');
            if (!scene || !draft || !ctx || !draftCtx) {
                return;
            }
            const state = drawingStore.getState();
            const dpr = window.devicePixelRatio || 1;
            const width = Math.round(state.viewport.w * dpr);
            const height = Math.round(state.viewport.h * dpr);
            for (const canvas of [scene, draft]) {
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
            }
            const options = { ...paintOptions(), fading: new Set(state.erasing), writing: state.editingTextId };
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            applyCamera(ctx, state.camera, dpr);
            paintElements(ctx, state.elements, options);

            draftCtx.setTransform(1, 0, 0, 1, 0, 0);
            draftCtx.clearRect(0, 0, width, height);
            if (state.draft) {
                applyCamera(draftCtx, state.camera, dpr);
                paintElements(draftCtx, [state.draft], options);
            }
        };
        const schedule = (): void => {
            frame ||= requestAnimationFrame(draw);
        };
        schedule();
        const unsubscribe = drawingStore.subscribe((state, previous) => {
            if (
                state.elements !== previous.elements ||
                state.camera !== previous.camera ||
                state.viewport !== previous.viewport ||
                state.draft !== previous.draft ||
                state.erasing !== previous.erasing ||
                state.editingTextId !== previous.editingTextId
            ) {
                schedule();
            }
        });
        return () => {
            unsubscribe();
            if (frame) {
                cancelAnimationFrame(frame);
            }
        };
        // The theme and the font change what the same elements look like, so both force a repaint.
    }, [drawingStore, theme, fontReady, id]);

    /* React makes wheel listeners passive, so the browser's own pinch zoom needs a native one. */
    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            const state = drawingStore.getState();
            const rect = root.getBoundingClientRect();
            const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            if (!e.ctrlKey && !e.metaKey) {
                state.panBy(-e.deltaX, -e.deltaY);
                return;
            }
            state.zoomAt(Math.exp(-e.deltaY * 0.01), anchor);
            zoomAnchor.current = anchor;
            if (zoomTimer.current) {
                window.clearTimeout(zoomTimer.current);
            }
            zoomTimer.current = window.setTimeout(() => drawingStore.getState().settleZoom(zoomAnchor.current), ZOOM_SETTLE_MS);
        };
        root.addEventListener('wheel', onWheel, { passive: false });
        return () => root.removeEventListener('wheel', onWheel);
    }, [drawingStore]);

    /* Space turns any tool into the hand for as long as it is held. */
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.code === 'Space' && !isTypingTarget(e.target)) {
                spaceRef.current = true;
            }
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            if (e.code === 'Space') {
                spaceRef.current = false;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    const screenPoint = (e: { clientX: number; clientY: number }): Point => {
        const rect = rootRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const worldPoint = (e: { clientX: number; clientY: number }): Point => toWorld(drawingStore.getState().camera, screenPoint(e));

    /* The setting says whether a drawing snaps; Cmd turns it around for as long as it is held. */
    const snapping = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => snapSetting !== (e.metaKey || e.ctrlKey);

    const start = (next: Gesture, e: React.PointerEvent): void => {
        gesture.current = next;
        setGestureKind(next.kind);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerDown = (e: React.PointerEvent): void => {
        if (e.button !== 0 && e.button !== 1) {
            return;
        }
        if (isChrome(e.target)) {
            return;
        }
        const state = drawingStore.getState();
        // A text being typed commits by losing focus, which the press it takes does for it.
        if (state.editingTextId !== null) {
            return;
        }
        if (state.tool === 'hand' || spaceRef.current || e.button === 1) {
            start({ kind: 'pan', last: { x: e.clientX, y: e.clientY } }, e);
            return;
        }
        const handle = (e.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle');
        const selected = state.elements.filter((element) => state.selection.includes(element.id));
        if (handle && selected.length > 0) {
            const bounds = boundsOfElements(selected)!;
            if (handle === 'rotate') {
                start({ kind: 'rotate', center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, id: selected[0]!.id, first: true }, e);
                return;
            }
            start({ kind: 'resize', handle: handle as ResizeHandle, from: bounds, elements: selected, first: true }, e);
            return;
        }
        const point = worldPoint(e);
        const snap = snapping(e);
        if (state.tool === 'eraser') {
            state.beginErase();
            eraseAt(point);
            start({ kind: 'erase' }, e);
            return;
        }
        if (state.tool === 'select') {
            const hit = elementAt(state.elements, point, HIT_TOLERANCE / state.camera.zoom);
            if (!hit) {
                if (!e.shiftKey) {
                    state.clearSelection();
                }
                start({ kind: 'marquee', origin: screenPoint(e), additive: e.shiftKey }, e);
                return;
            }
            if (e.shiftKey) {
                state.select([hit.id], true);
            } else if (!state.selection.includes(hit.id)) {
                state.select([hit.id]);
            }
            start({ kind: 'move', last: point, first: true }, e);
            return;
        }
        const from = snapPoint(point, snap);
        const style = state.style;
        const id = nextId('el');
        const seed = newSeed();
        if (state.tool === 'text') {
            // The editor takes focus during this press; without this the press's own default
            // action moves focus back to the surface and the editor commits empty at once.
            e.preventDefault();
            const element = textElement(from, style, id, seed);
            state.addElement(element);
            state.setEditingText(id);
            state.settleTool();
            return;
        }
        if (state.tool === 'freehand') {
            state.beginDraft({
                kind: 'freehand',
                id,
                seed,
                x: from.x,
                y: from.y,
                w: 0,
                h: 0,
                stroke: style.stroke,
                strokeWidth: style.strokeWidth,
                roughness: style.roughness,
                points: [[0, 0, ...(e.pointerType === 'mouse' ? [] : [e.pressure])] as [number, number, number?]]
            });
            start({ kind: 'draft', start: from }, e);
            return;
        }
        const draft =
            state.tool === 'line' || state.tool === 'arrow'
                ? lineElement(state.tool, from, from, style, id, seed)
                : shapeElement(state.tool, { ...from, w: 0, h: 0 }, style, id, seed);
        if (!draft) {
            return;
        }
        state.beginDraft(draft);
        start({ kind: 'draft', start: from }, e);
    };

    const eraseAt = (point: Point): void => {
        const state = drawingStore.getState();
        const hit = elementAt(state.elements, point, HIT_TOLERANCE / state.camera.zoom);
        if (hit) {
            state.eraseElement(hit.id);
        }
    };

    const onPointerMove = (e: React.PointerEvent): void => {
        const active = gesture.current;
        if (!active) {
            return;
        }
        const state = drawingStore.getState();
        const point = worldPoint(e);
        const snap = snapping(e);
        switch (active.kind) {
            case 'pan':
                state.panBy(e.clientX - active.last.x, e.clientY - active.last.y);
                active.last = { x: e.clientX, y: e.clientY };
                return;
            case 'erase':
                eraseAt(point);
                return;
            case 'marquee': {
                const rect = rectFromPoints(active.origin, screenPoint(e));
                setMarquee(rect);
                const world = rectFromPoints(toWorld(state.camera, active.origin), point);
                state.selectInRect(world, active.additive);
                return;
            }
            case 'move': {
                const to = snapPoint(point, snap);
                state.moveSelected(to.x - active.last.x, to.y - active.last.y, active.first);
                active.last = to;
                active.first = false;
                return;
            }
            case 'resize': {
                const to = resizeRect(active.from, active.handle, snapPoint(point, snap), e.shiftKey);
                // A note dragged by a corner scales what it says along with the paper; every other
                // handle only makes the box wider or taller, and the wrapped lines follow.
                const corner = active.handle.length === 2;
                const factor = active.from.w === 0 ? 1 : Math.abs(to.w / active.from.w);
                const moved = new Map(
                    active.elements.map((element) => {
                        const scaled = scaleElement(element, active.from, to);
                        const grown = scaled.kind === 'note' && corner ? { ...scaled, size: scaledTextSize(scaled.size, factor) } : scaled;
                        return [element.id, isWritten(grown) ? { ...grown, ...fitTextBox(grown) } : grown];
                    })
                );
                state.replaceElements(
                    state.elements.map((element) => moved.get(element.id) ?? element),
                    active.first
                );
                active.first = false;
                return;
            }
            case 'rotate': {
                const angle = Math.atan2(point.y - active.center.y, point.x - active.center.x) + Math.PI / 2;
                // A quarter turn at a time while Shift is held, the way a shape usually wants to sit.
                const settled = e.shiftKey ? Math.round(angle / (Math.PI / 4)) * (Math.PI / 4) : angle;
                state.updateElement(active.id, { angle: settled }, active.first);
                active.first = false;
                return;
            }
            case 'draft': {
                const draft = state.draft;
                if (!draft) {
                    return;
                }
                if (draft.kind === 'freehand') {
                    const events = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
                    const points = events.map((event) => {
                        const world = toWorld(state.camera, {
                            x: event.clientX - rootRef.current!.getBoundingClientRect().left,
                            y: event.clientY - rootRef.current!.getBoundingClientRect().top
                        });
                        return [world.x - draft.x, world.y - draft.y, ...(e.pointerType === 'mouse' ? [] : [event.pressure])] as [number, number, number?];
                    });
                    state.updateDraft({ points: [...draft.points, ...points] });
                    return;
                }
                if (draft.kind === 'line') {
                    const to = e.shiftKey ? constrainAngle(active.start, point) : snapPoint(point, snap);
                    state.updateDraft({
                        w: to.x - draft.x,
                        h: to.y - draft.y,
                        points: [
                            [0, 0],
                            [to.x - draft.x, to.y - draft.y]
                        ]
                    });
                    return;
                }
                state.updateDraft(shapeRect(active.start, snapPoint(point, snap), { square: e.shiftKey, fromCenter: e.altKey }));
            }
        }
    };

    const onPointerUp = (e: React.PointerEvent): void => {
        const active = gesture.current;
        gesture.current = null;
        setGestureKind(null);
        setMarquee(null);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (!active) {
            return;
        }
        const state = drawingStore.getState();
        if (active.kind === 'erase') {
            state.commitErase();
            return;
        }
        if (active.kind !== 'draft') {
            return;
        }
        const draft = state.draft;
        if (!draft) {
            return;
        }
        if (draft.kind === 'freehand') {
            state.updateDraft(settleStroke(draft));
            state.commitDraft();
            state.settleTool();
            return;
        }
        const tiny = Math.abs(draft.w) < DRAG_THRESHOLD && Math.abs(draft.h) < DRAG_THRESHOLD;
        if (tiny && draft.kind === 'line') {
            // A click is not a line; there is nothing between the two points.
            state.cancelDraft();
            state.settleTool();
            return;
        }
        if (tiny) {
            state.updateDraft(draft.kind === 'note' ? DEFAULT_NOTE : DEFAULT_SHAPE);
        }
        const id = state.commitDraft();
        state.settleTool();
        // A note is made to be written on, so it comes up with the caret already in it.
        if (draft.kind === 'note' && id) {
            state.setEditingText(id);
        }
    };

    const onDoubleClick = (e: React.MouseEvent): void => {
        if (isChrome(e.target)) {
            return;
        }
        const state = drawingStore.getState();
        if (state.tool !== 'select') {
            return;
        }
        const point = worldPoint(e);
        const hit = elementAt(state.elements, point, HIT_TOLERANCE / state.camera.zoom);
        if (hit && isWritten(hit)) {
            state.select([hit.id]);
            state.setEditingText(hit.id);
            return;
        }
        if (hit) {
            return;
        }
        const id = nextId('el');
        state.addElement(textElement(point, state.style, id, newSeed()));
        state.setEditingText(id);
    };

    const gridStep = GRID * 3 * camera.zoom;
    return (
        <div
            ref={rootRef}
            className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg bg-[image:radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)]"
            style={{
                backgroundSize: `${gridStep}px ${gridStep}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                // Space is held in a ref so a key does not repaint the drawing; the cursor catches
                // up on the next render, which the pointer move right after it always brings.
                // oxlint-disable-next-line react/refs
                cursor: cursorFor(tool, gestureKind, spaceRef.current)
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
        >
            <canvas ref={sceneRef} className="absolute inset-0 h-full w-full" />
            <canvas ref={draftRef} className="absolute inset-0 h-full w-full" />
            <DrawingOverlay marquee={marquee} />
            <DrawingDock />
        </div>
    );
}

/* What the pointer says it will do here: the tool, unless a gesture is already saying otherwise. */
const cursorFor = (tool: string, gesture: Gesture['kind'] | null, space: boolean): string => {
    if (gesture === 'pan') {
        return 'grabbing';
    }
    if (tool === 'hand' || space) {
        return 'grab';
    }
    if (tool === 'text') {
        return 'text';
    }
    if (tool === 'note') {
        return 'crosshair';
    }
    return tool === 'select' ? 'default' : 'crosshair';
};

const isTypingTarget = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
