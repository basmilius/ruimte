import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import clsx from 'clsx';
import { ImageOff, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { isImageMime, type FsReadResult } from '@ruimte/contracts';
import { fileBytesUrl } from '@/shell/panels/file-url';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';
import { BTN_GROUP } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

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
 * a slider: the pixel under the pointer stays where it is while everything else moves away from it.
 * `x` and `y` are offsets from the middle of the frame, so a scale of 1 is always centered.
 */
const zoomed = (view: View, factor: number, pointX: number, pointY: number): View => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    if (scale === MIN_SCALE) {
        return START;
    }
    const ratio = scale / view.scale;
    return { scale, x: pointX - (pointX - view.x) * ratio, y: pointY - (pointY - view.y) * ratio };
};

/* An image on its own, large: the wheel and the buttons zoom, dragging pans, Escape closes. */
function Lightbox({ src, alt, open, onOpenChange }: { src: string; alt: string; open: boolean; onOpenChange(open: boolean): void }) {
    const [view, setView] = useState<View>(START);
    const frameRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

    useEffect(() => {
        if (!open) {
            setView(START);
        }
    }, [open]);

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
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                {/* The shared popup centers itself with a transform; a lightbox fills the window instead. */}
                <Dialog.Popup className="dialog-popup inset-4 flex transform-none flex-col">
                    <Dialog.Title className="sr-only">{alt}</Dialog.Title>
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="min-w-0 truncate text-xs text-text-muted">{alt}</span>
                        <span className="grow" />
                        <span className="tabular-nums text-xs text-text-faint">{Math.round(view.scale * 100)}%</span>
                        <span className={BTN_GROUP}>
                            <Tooltip label="Zoom out" name>
                                <button className="icon-btn h-7 w-7 rounded" disabled={view.scale <= MIN_SCALE} onClick={() => zoomButton(1 / BUTTON_STEP)}>
                                    <Icon icon={Minus} size={16} />
                                </button>
                            </Tooltip>
                            <Tooltip label="Zoom in" name>
                                <button className="icon-btn h-7 w-7 rounded" disabled={view.scale >= MAX_SCALE} onClick={() => zoomButton(BUTTON_STEP)}>
                                    <Icon icon={Plus} size={16} />
                                </button>
                            </Tooltip>
                            <Tooltip label="Reset" name>
                                <button className="icon-btn h-7 w-7 rounded" disabled={view.scale === MIN_SCALE} onClick={() => setView(START)}>
                                    <Icon icon={RotateCcw} size={16} />
                                </button>
                            </Tooltip>
                        </span>
                        <Tooltip label="Close" kbd="esc" name>
                            <Dialog.Close className="icon-btn h-7 w-7 rounded">
                                <Icon icon={X} size={16} />
                            </Dialog.Close>
                        </Tooltip>
                    </div>
                    <div
                        ref={frameRef}
                        className={clsx('grid min-h-0 grow place-items-center overflow-hidden bg-surface-sunken', view.scale > MIN_SCALE && 'cursor-grab')}
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
                            className="max-h-full max-w-full select-none"
                            style={{ transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.scale})` }}
                        />
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* A thumbnail that opens the same image large. The button is the picture, so there is nothing to aim at. */
export function ImageThumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button className="block overflow-hidden rounded-lg border border-border" onClick={() => setOpen(true)}>
                <img src={src} alt={alt} className={className} />
            </button>
            <Lightbox src={src} alt={alt} open={open} onOpenChange={setOpen} />
        </>
    );
}

/*
 * The image an agent looked at with `Read`. The thread only carries the path, so the daemon is
 * asked what the file is; anything that is not an image draws nothing at all.
 */
export function ReadImage({ path }: { path: string }) {
    const [read, setRead] = useState<FsReadResult | null>(null);
    const [failed, setFailed] = useState(false);
    const transport = useTransport();
    const endpointId = useEndpointId();

    useEffect(() => {
        let cancelled = false;
        transport
            .request('fs.read', { path })
            .then((result) => {
                if (!cancelled) {
                    setRead(result);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFailed(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, path]);

    if (failed) {
        return (
            <div className="mb-1 ml-8 flex items-center gap-1.5 text-xs text-text-faint">
                <Icon icon={ImageOff} size={12} /> That file is no longer there
            </div>
        );
    }
    if (read?.kind !== 'binary' || !isImageMime(read.mime)) {
        return null;
    }
    return (
        <div className="mb-1 ml-8">
            <ImageThumb src={fileBytesUrl(path, read.mtime, read.size, endpointId)} alt={path} className="max-h-48 max-w-full object-contain" />
        </div>
    );
}
