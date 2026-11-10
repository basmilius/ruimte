import { boundsOfElements } from '@adecore/drawing';
import { EmptyState, useContentSize } from '@adecore/ui';
import type { DrawingElement } from '@ruimte/contracts';
import { PenTool } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cameraToFit } from '@/canvas-model/math';
import { loadDrawingFont } from '@/drawing/fonts';
import { useDrawingMirror } from '@/drawing/mirror';
import { applyCamera, paintElements, paintOptions } from '@/drawing/paint';
import { showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { usePaletteKey } from '@/state/theme';

/* World units of air around a mirrored drawing, so nothing touches the frame. */
const PADDING = 24;

const NO_ELEMENTS: DrawingElement[] = [];

/*
 * A drawing view on a canvas: the same file, painted to fit, never edited here. A double-click
 * opens the view, which is where a drawing is drawn.
 */
export function DrawingNode({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const viewId = useCanvas((s) => s.nodes[id]?.viewId ?? null);
    const mirror = useDrawingMirror(viewId);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [boxRef, { width, height }] = useContentSize();
    const [fontReady, setFontReady] = useState(false);
    const paletteKey = usePaletteKey();
    const elements = mirror?.snapshot ?? NO_ELEMENTS;

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

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        const bounds = boundsOfElements(elements);
        if (!canvas || !ctx || width === 0) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const camera = bounds === null ? null : cameraToFit(bounds, { w: width, h: height }, PADDING);
        if (camera === null) {
            return;
        }
        applyCamera(ctx, camera, dpr);
        paintElements(ctx, elements, paintOptions());
    }, [elements, width, height, paletteKey, fontReady]);

    return (
        <div ref={boxRef} className="h-full w-full" data-opens-view onDoubleClick={() => viewId && showView(viewId)}>
            {mirror?.gone && (
                <EmptyState icon={PenTool} className="h-full">
                    {t('drawing.gone')}
                </EmptyState>
            )}
            {!mirror?.gone && elements.length === 0 && !mirror?.loading && (
                <EmptyState icon={PenTool} className="h-full">
                    {t('drawing.empty')}
                </EmptyState>
            )}
            <canvas ref={canvasRef} className="h-full w-full" style={{ display: elements.length === 0 ? 'none' : undefined }} />
        </div>
    );
}
