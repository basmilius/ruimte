import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ImageOff, Minus, Plus, RotateCcw } from 'lucide-react';
import type { ResourceUrl } from '../../host';
import { ButtonGroup, CloseButton, Dialog, Icon, IconButton, Tooltip } from '@adecore/ui';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
// One wheel notch, small enough that a trackpad flick does not jump past the detail it aimed at.
const WHEEL_STEP = 1.0015;
const BUTTON_STEP = 1.5;

interface View {
    scale: number;
    x: number;
    y: number;
}

const START: View = { scale: 1, x: 0, y: 0 };

/*
 * Zooms around a point, which is what makes a wheel over a detail feel like a magnifier instead of
 * a slider. The pixel under the pointer stays where it is while everything else moves away from it.
 * `x` and `y` are offsets from the middle of the frame, so a scale of 1 is always centered.
 */
function zoomed(view: View, factor: number, pointX: number, pointY: number): View {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    if (scale === MIN_SCALE) {
        return START;
    }
    const ratio = scale / view.scale;
    return { scale, x: pointX - (pointX - view.x) * ratio, y: pointY - (pointY - view.y) * ratio };
}

/* An image on its own, large: the wheel and the buttons zoom, dragging pans, Escape closes. */
function Lightbox({ src, alt, open, onOpenChange }: { src: string; alt: string; open: boolean; onOpenChange(open: boolean): void }) {
    const { t } = useTranslation('agent-chat');
    const [view, setView] = useState<View>(START);
    // The alt of an image an agent read is its path; the header shows the file and keeps the path on a tooltip.
    const name = alt.slice(alt.lastIndexOf('/') + 1);
    const title = <span className="min-w-0 truncate text-xs text-text">{name}</span>;
    const frameRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

    if (!open && view !== START) {
        setView(START);
    }

    /* Where the pointer sits against the middle of the frame, which is what the transform counts from. */
    const pointIn = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) {
            return { x: 0, y: 0 };
        }
        return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
    };

    const zoomButton = (factor: number): void => setView((current) => zoomed(current, factor, 0, 0));

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            {/* Nothing here sets a size. The picture takes the room `.lightbox-frame` allows it, and the popup follows. */}
            <Dialog.Popup backdropClassName="lightbox-backdrop" className="flex min-w-72 flex-col">
                <Dialog.Title className="sr-only">{alt}</Dialog.Title>
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
                    {name === alt ? title : <Tooltip label={alt}>{title}</Tooltip>}
                    <span className="grow" />
                    <span className="tabular-nums text-xs text-text-faint">{Math.round(view.scale * 100)}%</span>
                    <ButtonGroup render={<span />}>
                        <IconButton
                            icon={Minus}
                            size="sm"
                            label={t('image.zoomOut')}
                            disabled={view.scale <= MIN_SCALE}
                            onClick={() => zoomButton(1 / BUTTON_STEP)}
                        />
                        <IconButton
                            icon={Plus}
                            size="sm"
                            label={t('image.zoomIn')}
                            disabled={view.scale >= MAX_SCALE}
                            onClick={() => zoomButton(BUTTON_STEP)}
                        />
                        <IconButton icon={RotateCcw} size="sm" label={t('image.reset')} disabled={view.scale === MIN_SCALE} onClick={() => setView(START)} />
                    </ButtonGroup>
                    <CloseButton label={t('common.action.close')} kbd="esc" className="ml-1" dialog />
                </div>
                <div
                    ref={frameRef}
                    className={clsx('lightbox-frame grid place-items-center overflow-hidden bg-surface-sunken', view.scale > MIN_SCALE && 'cursor-grab')}
                    onWheel={(e) => {
                        const point = pointIn(e);
                        setView((current) => zoomed(current, WHEEL_STEP ** -e.deltaY, point.x, point.y));
                    }}
                    onDoubleClick={(e) => {
                        const point = pointIn(e);
                        setView((current) => (current.scale > MIN_SCALE ? START : zoomed(current, 2, point.x, point.y)));
                    }}
                    onPointerDown={(e) => {
                        if (view.scale <= MIN_SCALE) {
                            return;
                        }
                        e.currentTarget.setPointerCapture(e.pointerId);
                        dragRef.current = { pointerId: e.pointerId, x: e.clientX - view.x, y: e.clientY - view.y };
                    }}
                    onPointerMove={(e) => {
                        const drag = dragRef.current;
                        if (drag?.pointerId === e.pointerId) {
                            setView((current) => ({ ...current, x: e.clientX - drag.x, y: e.clientY - drag.y }));
                        }
                    }}
                    onPointerUp={() => {
                        dragRef.current = null;
                    }}
                    onPointerCancel={() => {
                        dragRef.current = null;
                    }}
                >
                    <img
                        src={src}
                        alt={alt}
                        draggable={false}
                        className="select-none"
                        style={{ transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.scale})` }}
                    />
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/*
 * A thumbnail that opens the same image large. The button is the picture, so there is nothing to aim at.
 * The image is bytes where the host keeps them; until they are here a quiet square stands in for it.
 */
export function ImageThumb({ source, alt, className }: { source: ResourceUrl; alt: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const { url: src, failure } = source;
    if (src === null) {
        return (
            <span className="grid size-16 place-items-center rounded-lg border border-border bg-surface-sunken text-text-faint">
                {failure !== null && (
                    <Tooltip label={failure}>
                        <Icon icon={ImageOff} size={14} />
                    </Tooltip>
                )}
            </span>
        );
    }
    return (
        <>
            <button className="block overflow-hidden rounded-lg border border-border" onClick={() => setOpen(true)}>
                <img src={src} alt={alt} className={className} />
            </button>
            <Lightbox src={src} alt={alt} open={open} onOpenChange={setOpen} />
        </>
    );
}
