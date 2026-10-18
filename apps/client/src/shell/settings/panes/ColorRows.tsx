import { useTranslation } from 'react-i18next';
import { ColorWheelPicker } from '@adecore/ui';
import { NODE_ACCENTS, accentColor, accentLabel, type AccentId } from '@/canvas/accents';
import { previewColors, useSettings } from '@/state/settings';
import { PALETTE_NEUTRALS, presetSwatch, type PalettePreset } from '@/state/palette-presets';
import { TAILWIND_COLORS } from '@/state/tailwind-palettes';

/* The tint of the grounds, panels and text: the colors round the outside in Tailwind's order, which is the
   order of their hues, and the default in the middle with the neutrals on a ring round it. */
export function PaletteRow() {
    const { t } = useTranslation('settings');
    const palette = useSettings((s) => s.palette);
    const update = useSettings((s) => s.update);
    return (
        <ColorWheelPicker<PalettePreset>
            value={palette}
            label={t('appearance.palette.label')}
            rings={[TAILWIND_COLORS, PALETTE_NEUTRALS]}
            center="default"
            colorOf={presetSwatch}
            labelOf={(id) => t(`appearance.palette.options.${id}`)}
            align="end"
            onPreviewChange={(id) => previewColors(id === null ? null : { palette: id })}
            onValueChange={(id) => update({ palette: id })}
        />
    );
}

const ACCENT_IDS = NODE_ACCENTS.map((entry) => entry.id);

/* The accent of the whole app, on the same wheel as the palette so both are picked the same way: the
   node accents round it in their order, which is the order of their hues. */
export function AccentRow() {
    const { t } = useTranslation('settings');
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    return (
        <ColorWheelPicker<AccentId>
            value={accent}
            label={t('appearance.accent.label')}
            rings={[ACCENT_IDS]}
            colorOf={(id) => accentColor(id) ?? ''}
            labelOf={accentLabel}
            align="end"
            onPreviewChange={(id) => previewColors(id === null ? null : { accent: id })}
            onValueChange={(id) => update({ accent: id })}
        />
    );
}
