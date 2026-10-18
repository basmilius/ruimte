import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button, ColorSwatch, Icon, Popover } from '@adecore/ui';
import { previewPalette, useSettings } from '@/state/settings';
import { PALETTE_NEUTRALS, presetSwatch, type PalettePreset } from '@/state/palette-presets';
import { TAILWIND_COLORS } from '@/state/tailwind-palettes';

const WHEEL_SIZE = 232;
const SWATCH_SIZE = 24;

/* A spot on the wheel, a share of a turn round from the top at a share of the wheel's size from its
   middle, in whole pixels for the swatch's top left corner. */
function wheelSpot(turn: number, radius: number): { left: number; top: number } {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    const center = (WHEEL_SIZE - SWATCH_SIZE) / 2;
    return {
        left: Math.round(center + radius * WHEEL_SIZE * Math.cos(angle)),
        top: Math.round(center + radius * WHEEL_SIZE * Math.sin(angle))
    };
}

/* Every palette on the wheel: the colors evenly round the outside in Tailwind's order, which is the order
   of their hues, the default in the middle and the neutrals on a ring round it. */
const WHEEL: readonly { id: PalettePreset; left: number; top: number }[] = [
    ...TAILWIND_COLORS.map((id, i) => ({ id, ...wheelSpot(i / TAILWIND_COLORS.length, 0.42) })),
    { id: 'default', ...wheelSpot(0, 0) },
    ...PALETTE_NEUTRALS.map((id, i) => ({ id, ...wheelSpot(i / PALETTE_NEUTRALS.length, 0.2) }))
];

/*
 * The tint of the grounds, panels and text. The row holds the one in use; the wheel behind it holds them
 * all, and the app wears the one under the pointer or the focus while the wheel is open, so the whole
 * window is the preview. Its name stands under the wheel, which is why a swatch carries no tooltip.
 */
export function PaletteRow() {
    const { t } = useTranslation('settings');
    const palette = useSettings((s) => s.palette);
    const update = useSettings((s) => s.update);
    const [open, setOpen] = useState(false);
    const [looking, setLooking] = useState<PalettePreset | null>(null);
    // The wheel opens with the focus on the palette in use: the first swatch would take it otherwise, and a
    // swatch with the focus is one a person is looking at, so the app would put on its colors unasked.
    const pickedRef = useRef<HTMLButtonElement>(null);
    const look = (preset: PalettePreset | null): void => {
        setLooking(preset);
        previewPalette(preset);
    };
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
                <span className="h-4 w-4 rounded-full" style={{ background: presetSwatch(palette) }} aria-hidden />
                {t(`appearance.palette.options.${palette}`)}
                <Icon icon={ChevronDown} size={14} />
            </Popover.Trigger>
            <Popover.Popup align="end" initialFocus={pickedRef} className="flex flex-col items-center gap-3 p-4">
                <div
                    role="radiogroup"
                    aria-label={t('appearance.palette.label')}
                    className="relative"
                    style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
                    onPointerLeave={() => look(null)}
                >
                    {WHEEL.map(({ id, left, top }) => (
                        <ColorSwatch
                            key={id}
                            ref={palette === id ? pickedRef : undefined}
                            role="radio"
                            aria-checked={palette === id}
                            aria-label={t(`appearance.palette.options.${id}`)}
                            color={presetSwatch(id)}
                            picked={palette === id}
                            on="popup"
                            className="absolute"
                            style={{ left, top }}
                            onPointerEnter={() => look(id)}
                            onFocus={() => look(id)}
                            onClick={() => {
                                update({ palette: id });
                                setLooking(null);
                                setOpen(false);
                            }}
                        />
                    ))}
                </div>
                <span className="text-xs text-text-muted">{t(`appearance.palette.options.${looking ?? palette}`)}</span>
            </Popover.Popup>
        </Popover.Root>
    );
}
