import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, ColorSwatch, Icon, Popover } from '@adecore/ui';

const WHEEL_SIZE = 232;
const SWATCH_SIZE = 24;

/* How far from the middle each ring stands, as a share of the wheel's size, outermost first. */
const RING_RADII = [0.42, 0.2];

export interface WheelPickerProps<Id extends string> {
    value: Id;
    label: string;
    /* The swatches round the wheel, a ring at a time from the outside in, each in its own order from the top. */
    rings: readonly (readonly Id[])[];
    /* The one in the middle, if any. */
    center?: Id;
    colorOf(id: Id): string;
    labelOf(id: Id): string;
    /* The one under the pointer or the focus while the wheel is open, or null once it is no longer looked at. */
    onPreview(id: Id | null): void;
    onValueChange(id: Id): void;
}

/* A spot on the wheel, a share of a turn round from the top at a share of the wheel's size from its middle,
   in whole pixels for the swatch's top left corner. */
function wheelSpot(turn: number, radius: number): { left: number; top: number } {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    const middle = (WHEEL_SIZE - SWATCH_SIZE) / 2;
    return {
        left: Math.round(middle + radius * WHEEL_SIZE * Math.cos(angle)),
        top: Math.round(middle + radius * WHEEL_SIZE * Math.sin(angle))
    };
}

/*
 * A color picked from a wheel behind a button that holds the one in use. While the wheel is open the
 * swatch under the pointer or the focus is previewed, so the window itself shows it; its name stands under
 * the wheel, which is why a swatch carries no tooltip. Closing without a pick ends the preview.
 */
export function WheelPicker<Id extends string>({ value, label, rings, center, colorOf, labelOf, onPreview, onValueChange }: WheelPickerProps<Id>) {
    const [open, setOpen] = useState(false);
    const [looking, setLooking] = useState<Id | null>(null);
    // The wheel opens with the focus on the one in use: the first swatch would take it otherwise, and a
    // swatch with the focus is one a person is looking at, so the app would put on its colors unasked.
    const pickedRef = useRef<HTMLButtonElement>(null);
    // Read by the cleanup below, which runs after the state and the props of its render are gone.
    const preview = useRef({ looking: false, onPreview });
    useEffect(() => {
        preview.current.onPreview = onPreview;
    });
    const look = (id: Id | null): void => {
        setLooking(id);
        preview.current.looking = id !== null;
        onPreview(id);
    };
    // A wheel taken away while a color is previewed (its dialog closed under it) gets no close of its
    // popover, so it ends the preview itself rather than leave the window in colors nobody picked.
    useEffect(
        () => () => {
            if (preview.current.looking) {
                preview.current.onPreview(null);
            }
        },
        []
    );
    const spots = [
        ...rings.flatMap((ring, depth) => ring.map((id, i) => ({ id, ...wheelSpot(i / ring.length, RING_RADII[depth] ?? 0) }))),
        ...(center === undefined ? [] : [{ id: center, ...wheelSpot(0, 0) }])
    ];
    return (
        <Popover.Root
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    look(null);
                }
            }}
        >
            <Popover.Trigger render={<Button variant="secondary" size="md" />}>
                <span className="h-4 w-4 rounded-full" style={{ background: colorOf(value) }} aria-hidden />
                {labelOf(value)}
                <Icon icon={ChevronDown} size={14} />
            </Popover.Trigger>
            <Popover.Popup align="end" initialFocus={pickedRef} className="flex flex-col items-center gap-3 p-4">
                <div
                    role="radiogroup"
                    aria-label={label}
                    className="relative"
                    style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
                    onPointerLeave={() => look(null)}
                >
                    {spots.map(({ id, left, top }) => (
                        <ColorSwatch
                            key={id}
                            ref={value === id ? pickedRef : undefined}
                            role="radio"
                            aria-checked={value === id}
                            aria-label={labelOf(id)}
                            color={colorOf(id)}
                            picked={value === id}
                            on="popup"
                            className="absolute"
                            style={{ left, top }}
                            onPointerEnter={() => look(id)}
                            onFocus={() => look(id)}
                            onClick={() => {
                                onValueChange(id);
                                setLooking(null);
                                setOpen(false);
                            }}
                        >
                            {/* Not the tick a picked swatch draws by default: on a swatch of two tones it reads as a glitch, and the ring says it already. */}
                            {false}
                        </ColorSwatch>
                    ))}
                </div>
                <span className="text-xs text-text-muted">{labelOf(looking ?? value)}</span>
            </Popover.Popup>
        </Popover.Root>
    );
}
