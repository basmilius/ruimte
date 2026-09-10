import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GRID } from '@/canvas/math';
import { loadDrawingFont } from '@/drawing/fonts';
import { applyCamera, clearPathCache, paintElements } from '@/drawing/paint';
import { readFontStacks, readPalette } from '@/drawing/palette';
import { useDrawing } from '@/state/drawing';
import { useTheme } from '@/state/theme';

/* The wheel settles on a whole percent this long after the last tick, as the canvas does. */
const ZOOM_SETTLE_MS = 160;

/*
 * A drawing on screen: one canvas for what is drawn, a second for the stroke in the making, and a
 * DOM layer above them for the handles and the text editor, which stay whole pixels at any zoom.
 */
export function DrawingView({ id }: { id: string }) {
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
    const [panning, setPanning] = useState(false);
    const pan = useRef<{ x: number; y: number } | null>(null);

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
            useDrawing.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

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
            const state = useDrawing.getState();
            const dpr = window.devicePixelRatio || 1;
            const width = Math.round(state.viewport.w * dpr);
            const height = Math.round(state.viewport.h * dpr);
            for (const canvas of [scene, draft]) {
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
            }
            const options = { palette: readPalette(), fonts: readFontStacks(), fading: new Set(state.erasing) };
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
        const unsubscribe = useDrawing.subscribe((state, previous) => {
            if (
                state.elements !== previous.elements ||
                state.camera !== previous.camera ||
                state.viewport !== previous.viewport ||
                state.draft !== previous.draft ||
                state.erasing !== previous.erasing
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
    }, [theme, fontReady, id]);

    /* A drawing this machine has no camera for opens on everything it holds, once there is room. */
    useEffect(() => {
        const fit = (): void => {
            const state = useDrawing.getState();
            if (state.fitPending && state.viewport.w > 0) {
                state.fitAll();
            }
        };
        fit();
        return useDrawing.subscribe(fit);
    }, []);

    /* React makes wheel listeners passive, so the browser's own pinch zoom needs a native one. */
    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            const state = useDrawing.getState();
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
            zoomTimer.current = window.setTimeout(() => useDrawing.getState().settleZoom(zoomAnchor.current), ZOOM_SETTLE_MS);
        };
        root.addEventListener('wheel', onWheel, { passive: false });
        return () => root.removeEventListener('wheel', onWheel);
    }, []);

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

    /* Panning is the whole gesture layer for now; the tools bring their own in the next step. */
    const onPointerDown = (e: React.PointerEvent): void => {
        const hand = useDrawing.getState().tool === 'hand' || spaceRef.current || e.button === 1;
        if (!hand) {
            return;
        }
        e.preventDefault();
        pan.current = { x: e.clientX, y: e.clientY };
        setPanning(true);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent): void => {
        if (!pan.current) {
            return;
        }
        useDrawing.getState().panBy(e.clientX - pan.current.x, e.clientY - pan.current.y);
        pan.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: React.PointerEvent): void => {
        if (!pan.current) {
            return;
        }
        pan.current = null;
        setPanning(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
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
                cursor: panning ? 'grabbing' : tool === 'hand' || spaceRef.current ? 'grab' : 'crosshair'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            <canvas ref={sceneRef} className="absolute inset-0 h-full w-full" />
            <canvas ref={draftRef} className="absolute inset-0 h-full w-full" />
        </div>
    );
}

const isTypingTarget = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
