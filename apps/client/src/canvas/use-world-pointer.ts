import { useEffect, useState, type RefObject } from 'react';
import { toWorld, type Point } from '@/canvas-model/math';
import { useCanvasStore } from '@/state/canvas';

/* Where the pointer is on the canvas in world units, once per frame, or null while it is elsewhere. */
export function useWorldPointer(rootRef: RefObject<HTMLDivElement | null>): Point | null {
    const canvasStore = useCanvasStore();
    const [point, setPoint] = useState<Point | null>(null);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        let frame: number | null = null;
        let latest: Point | null = null;
        const onMove = (e: PointerEvent): void => {
            const rect = el.getBoundingClientRect();
            latest = toWorld(canvasStore.getState().camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
            // What lights up near the pointer must not re-render on every sample the pointer sends.
            if (frame === null) {
                frame = window.requestAnimationFrame(() => {
                    frame = null;
                    setPoint(latest);
                });
            }
        };
        const onLeave = (): void => setPoint(null);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        return () => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [canvasStore, rootRef]);

    return point;
}
