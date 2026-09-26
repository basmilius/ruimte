import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { Icon } from './Icon.tsx';
import { formatPercent } from './format/number.ts';
import { splitAt, splitForKey } from './wipe.ts';

/*
 * Two versions of one picture in one frame: `before` left of the split and `after` right of it, with a
 * handle between them a person drags or moves with the arrow keys. It fills the positioned element it
 * sits in; `split` is the share of the width left of the handle, from 0 to 1.
 */
export function Wipe({
    split,
    onSplit,
    before,
    after,
    label
}: {
    split: number;
    onSplit: (split: number) => void;
    before: ReactNode;
    after: ReactNode;
    label: string;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const percent = `${split * 100}%`;

    function moveTo(clientX: number): void {
        const rect = frame.current?.getBoundingClientRect();
        const next = rect ? splitAt(clientX, rect) : null;
        if (next !== null) {
            onSplit(next);
        }
    }

    function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
    }

    function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            moveTo(e.clientX);
        }
    }

    function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
        const next = splitForKey(split, e.key);
        if (next === null) {
            return;
        }
        // Only while the handle has the focus, so a canvas or a timeline around it never hears these keys.
        e.preventDefault();
        e.stopPropagation();
        onSplit(next);
    }

    return (
        <div ref={frame} className="absolute inset-0">
            <div className="absolute inset-0">{before}</div>
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${percent})` }}>
                {after}
            </div>
            <div
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split * 100)}
                aria-valuetext={formatPercent(Math.round(split * 100))}
                className="absolute inset-y-0 z-10 -ml-3.5 w-7 cursor-ew-resize touch-none"
                style={{ left: percent }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onKeyDown={onKeyDown}
            >
                <span className="absolute inset-y-0 left-3.25 w-0.5 bg-media-handle shadow-media-handle-edge" />
                <span className="absolute top-1/2 left-3.5 grid h-7 w-7 -translate-1/2 place-items-center rounded-full bg-media-handle text-media-handle-text shadow-media-handle">
                    <Icon icon={ChevronsLeftRight} size={14} />
                </span>
            </div>
        </div>
    );
}
