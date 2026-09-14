import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PenTool } from 'lucide-react';
import { boundsOfElements } from '@ruimte/drawing';
import { cameraToFit } from '@/canvas/math';
import { loadDrawingFont } from '@/drawing/fonts';
import { useDrawingMirror } from '@/drawing/mirror';
import { applyCamera, paintElements, paintOptions } from '@/drawing/paint';
import { showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useTheme } from '@/state/theme';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* World units of air around a mirrored drawing, so nothing touches the frame. */
const PADDING = 24;

/*
 * A drawing view on a canvas: the same file, painted to fit, never edited here. A double-click
 * opens the view, which is where a drawing is drawn.
 */
export function DrawingNode({ id }: { id: string }) {
    const viewId = useCanvas((s) => s.nodes[id]?.viewId ?? null);
    const mirror = useDrawingMirror(viewId);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [fontReady, setFontReady] = useState(false);
    const theme = useTheme((s) => s.resolved);
    const elements = mirror?.elements ?? [];

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

    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => setSize({ w: entry!.contentRect.width, h: entry!.contentRect.height }));
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        const bounds = boundsOfElements(elements);
        if (!canvas || !ctx || size.w === 0) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const camera = bounds === null ? null : cameraToFit(bounds, size, PADDING);
        if (camera === null) {
            return;
        }
        applyCamera(ctx, camera, dpr);
        paintElements(ctx, elements, paintOptions());
    }, [elements, size, theme, fontReady]);

    return (
        <div ref={boxRef} className="h-full w-full" onDoubleClick={() => viewId && showView(viewId)}>
            {mirror?.gone && (
                <EmptyState icon={<Icon icon={PenTool} size={16} />} className="h-full">
                    This drawing was removed from the project.
                </EmptyState>
            )}
            {!mirror?.gone && elements.length === 0 && !mirror?.loading && (
                <EmptyState icon={<Icon icon={PenTool} size={16} />} className="h-full">
                    Nothing drawn yet. Double-click to draw.
                </EmptyState>
            )}
            <canvas ref={canvasRef} className="h-full w-full" style={{ display: elements.length === 0 ? 'none' : undefined }} />
        </div>
    );
}
