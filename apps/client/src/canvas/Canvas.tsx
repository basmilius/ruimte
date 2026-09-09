import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GRID, intersects, snapToGrid, toWorld, type Point, type Rect } from '@/canvas/math';
import { useCanvas } from '@/state/canvas';
import { EdgeLayer } from '@/canvas/EdgeLayer';
import { NodeFrame } from '@/canvas/NodeFrame';
import { TextElementView } from '@/canvas/TextElementView';

type Gesture =
    | { kind: 'pan'; last: Point }
    | { kind: 'box'; origin: Point; current: Point; additive: boolean }
    | { kind: 'move'; start: Point; applied: Point; moved: boolean }
    | { kind: 'resize'; nodeId: string; edge: string; start: Point; rect: Rect };

const ZOOM_SETTLE_MS = 160;
const MIN_NODE = { w: 240, h: 160 };

const isTypingTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
};

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
    const rootRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    const spaceRef = useRef(false);
    const zoomTimer = useRef<number | null>(null);
    const zoomAnchor = useRef<Point>({ x: 0, y: 0 });
    const zoomMoved = useRef(false);
    const [box, setBox] = useState<Rect | null>(null);
    const [activeGesture, setActiveGesture] = useState<Gesture['kind'] | null>(null);

    const { camera, order, texts, mode, locks } = useCanvas(useShallow((s) => ({
        camera: s.camera,
        order: s.order,
        texts: s.texts,
        mode: s.mode,
        locks: s.locks
    })));
    const textIds = useMemo(() => Object.keys(texts), [texts]);

    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            useCanvas.getState().setViewport({ w: entry.contentRect.width, h: entry.contentRect.height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const state = useCanvas.getState();
        if (state.viewport.w > 0) {
            state.fitAll();
        } else {
            const unsub = useCanvas.subscribe((s, prev) => {
                if (prev.viewport.w === 0 && s.viewport.w > 0) {
                    s.fitAll();
                    unsub();
                }
            });
        }
    }, []);

    /* React registers wheel listeners as passive, so preventDefault there cannot stop the
       browser's own pinch zoom. The canvas needs a native, non-passive listener. */
    useEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        const onWheel = (e: WheelEvent): void => {
            const s = useCanvas.getState();
            const target = e.target as HTMLElement;
            const ownerId = target.closest('[data-node-body]')?.closest('[data-node-id]')?.getAttribute('data-node-id');
            const isZoom = e.ctrlKey || e.metaKey;
            /* A focused node owns the wheel inside its body. Pinch is always the camera's. */
            if (!isZoom && s.mode.kind === 'node' && ownerId === s.mode.nodeId) {
                return;
            }
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
                        useCanvas.getState().settleZoom(zoomAnchor.current);
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
            if ((e.ctrlKey || e.metaKey) && !el.contains(e.target as Node)) {
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
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const s = useCanvas.getState();
            if (e.code === 'Space' && !isTypingTarget(e.target)) {
                spaceRef.current = true;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape') {
                if (s.editingTextId) {
                    s.setEditingText(null);
                } else if (s.mode.kind === 'node') {
                    s.exitNode();
                } else {
                    s.clearSelection();
                }
                (document.activeElement as HTMLElement | null)?.blur();
                return;
            }
            if (isTypingTarget(e.target) || s.mode.kind === 'node') {
                return;
            }
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.code === 'Digit0') {
                e.preventDefault();
                s.zoomTo(1);
            } else if (e.shiftKey && e.code === 'Digit1') {
                e.preventDefault();
                s.fitAll();
            } else if (e.shiftKey && e.code === 'Digit2') {
                e.preventDefault();
                s.zoomToSelection();
            } else if (mod && e.key === 'a') {
                e.preventDefault();
                s.select([...s.order, ...Object.keys(s.texts)]);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
                e.preventDefault();
                s.deleteSelected();
            } else if (e.key === '=' || e.key === '+') {
                s.zoomTo(Math.round(s.camera.zoom * 100 + 10) / 100);
            } else if (e.key === '-') {
                s.zoomTo(Math.round(s.camera.zoom * 100 - 10) / 100);
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

    /* A move only counts as a gesture once the pointer has moved: a plain click must not light the grid. */
    const startGesture = (g: Gesture, e: ReactPointerEvent): void => {
        gestureRef.current = g;
        if (g.kind !== 'move') {
            setActiveGesture(g.kind);
        }
        rootRef.current!.setPointerCapture(e.pointerId);
    };

    const onPointerDown = (e: ReactPointerEvent): void => {
        const s = useCanvas.getState();
        const target = e.target as HTMLElement;
        const point = screenPoint(e);
        const nodeId = target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null;
        const textId = target.closest<HTMLElement>('[data-text-id]')?.dataset.textId ?? null;

        if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
            if (!s.locks.pan) {
                e.preventDefault();
                startGesture({ kind: 'pan', last: point }, e);
            }
            return;
        }
        if (e.button !== 0) {
            return;
        }

        const resizeEdge = target.closest<HTMLElement>('[data-resize]')?.dataset.resize;
        if (resizeEdge && nodeId && !s.locks.resize) {
            e.preventDefault();
            s.setResizing(nodeId);
            startGesture({ kind: 'resize', nodeId, edge: resizeEdge, start: point, rect: { ...s.nodes[nodeId] } }, e);
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
            startGesture({ kind: 'move', start: point, applied: { x: 0, y: 0 }, moved: false }, e);
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
            startGesture({ kind: 'move', start: point, applied: { x: 0, y: 0 }, moved: false }, e);
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
        startGesture({ kind: 'box', origin: point, current: point, additive: e.shiftKey }, e);
    };

    const onPointerMove = (e: ReactPointerEvent): void => {
        const g = gestureRef.current;
        if (!g) {
            return;
        }
        const s = useCanvas.getState();
        const point = screenPoint(e);
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
                    if (!g.moved) {
                        g.moved = true;
                        setActiveGesture('move');
                    }
                    g.applied = wanted;
                    s.moveSelected(dx, dy);
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
        }
    };

    const onPointerUp = (e: ReactPointerEvent): void => {
        const g = gestureRef.current;
        gestureRef.current = null;
        setActiveGesture(null);
        if (!g) {
            return;
        }
        const s = useCanvas.getState();
        rootRef.current?.releasePointerCapture(e.pointerId);
        if (g.kind === 'box') {
            setBox(null);
            if (Math.abs(g.current.x - g.origin.x) > 3 || Math.abs(g.current.y - g.origin.y) > 3) {
                const a = toWorld(s.camera, g.origin);
                const b = toWorld(s.camera, g.current);
                const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
                if (g.additive) {
                    s.select(Object.values(s.nodes).filter((n) => intersects(n, rect)).map((n) => n.id), true);
                } else {
                    s.selectInRect(rect);
                }
            }
        } else if (g.kind === 'move' && g.moved) {
            s.settleMove();
        } else if (g.kind === 'resize') {
            s.setResizing(null);
        }
    };

    const onDoubleClick = (e: React.MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-node-id]') || target.closest('[data-text-id]')) {
            return;
        }
        const s = useCanvas.getState();
        s.addText(toWorld(s.camera, screenPoint(e)));
    };

    const gridStep = GRID * 3 * camera.zoom;

    return (
        <div
            ref={rootRef}
            className="canvas-grid relative h-full w-full overflow-hidden touch-none"
            style={{
                backgroundSize: `${gridStep}px ${gridStep}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                // Space is tracked in a ref because a held key must not re-render the canvas; the cursor
                // catches up on the next render, which the pointer move that follows always triggers.
                // oxlint-disable-next-line react/refs
                cursor: activeGesture === 'pan' ? 'grabbing' : locks.pan ? undefined : spaceRef.current ? 'grab' : undefined
            }}
            data-mode={mode.kind}
            data-gesture={activeGesture ?? undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
        >
            <div
                className="absolute left-0 top-0 origin-top-left"
                style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
            >
                <EdgeLayer />
                {textIds.map((id) => <TextElementView key={id} id={id} />)}
                {order.map((id) => <NodeFrame key={id} id={id} />)}
            </div>
            {box && (
                <div
                    className="pointer-events-none absolute rounded-sm border border-accent bg-accent/10"
                    style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                />
            )}
        </div>
    );
}
