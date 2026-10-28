import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, Send } from 'lucide-react';
import type { ChatAttachmentUpload } from '@ruimte/contracts';
import { Button, Icon, IconButton, Input } from '@adecore/ui';
import { strokesBox, type Point, type Rect } from '@/design/design-page';

/* Every stroke on the canvas, in the color of the pen, at the pixels of the screen. */
function paintStrokes(element: HTMLCanvasElement, strokes: readonly (readonly Point[])[]): void {
    const context = element.getContext('2d');

    if (context === null) {
        return;
    }

    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, element.clientWidth, element.clientHeight);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = getComputedStyle(element).getPropertyValue('--status-error').trim() || getComputedStyle(element).color;

    for (const stroke of strokes) {
        context.beginPath();
        stroke.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
        context.stroke();
    }
}

/*
 * Draw: a pen over the whole stage, above the page, and a line to say what the drawing means. What goes
 * to the chat is the drawing cut to its strokes, with the options it lay over named by the page.
 */
export function DesignDrawLayer({ onSend }: { onSend(image: ChatAttachmentUpload, rect: Rect, note: string): Promise<boolean> }) {
    const { t } = useTranslation('shell');
    const canvas = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<Point[][]>([]);
    const [count, setCount] = useState(0);
    const [note, setNote] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        const element = canvas.current;

        if (element === null) {
            return;
        }

        const fit = (): void => {
            const ratio = window.devicePixelRatio || 1;
            element.width = Math.round(element.clientWidth * ratio);
            element.height = Math.round(element.clientHeight * ratio);
            paintStrokes(element, strokes.current);
        };

        const observer = new ResizeObserver(fit);
        observer.observe(element);
        fit();

        return () => observer.disconnect();
    }, []);

    const redraw = (): void => {
        if (canvas.current !== null) {
            paintStrokes(canvas.current, strokes.current);
        }
    };

    const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const clear = (): void => {
        strokes.current = [];
        setCount(0);
        redraw();
    };

    const send = async (): Promise<void> => {
        const element = canvas.current;
        const box = element === null ? null : strokesBox(strokes.current, { width: element.clientWidth, height: element.clientHeight });

        if (element === null || box === null) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        const cut = document.createElement('canvas');
        cut.width = Math.round(box.width * ratio);
        cut.height = Math.round(box.height * ratio);
        cut.getContext('2d')?.drawImage(element, box.x * ratio, box.y * ratio, box.width * ratio, box.height * ratio, 0, 0, cut.width, cut.height);
        const data = cut.toDataURL('image/png').split(',')[1] ?? '';
        setSending(true);

        if (await onSend({ name: 'drawing.png', mime: 'image/png', data }, box, note)) {
            clear();
            setNote('');
        }

        setSending(false);
    };

    return (
        <div className="absolute inset-0 z-10 flex flex-col">
            <canvas
                ref={canvas}
                className="min-h-0 w-full grow cursor-crosshair touch-none text-status-error"
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    strokes.current.push([pointOf(event)]);
                }}
                onPointerMove={(event) => {
                    if (event.buttons !== 1 || strokes.current.length === 0) {
                        return;
                    }
                    strokes.current.at(-1)!.push(pointOf(event));
                    redraw();
                }}
                onPointerUp={() => setCount(strokes.current.length)}
            />
            <div className="menu-popup absolute bottom-3 left-1/2 flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 p-2">
                <Input
                    size="sm"
                    value={note}
                    placeholder={t('design.draw.placeholder')}
                    onChange={(event) => setNote(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            void send();
                        }
                    }}
                />
                <IconButton icon={Eraser} size="sm" label={t('design.draw.clear')} disabled={count === 0} onClick={clear} />
                <Button size="sm" variant="primary" disabled={count === 0 || sending} onClick={() => void send()}>
                    <Icon icon={Send} size={14} />
                    {t('design.draw.send')}
                </Button>
            </div>
        </div>
    );
}
