import type { PaletteSide, PaletteSideInput, PaletteToken } from '@/state/palette';
import { TAILWIND_COLORS, TAILWIND_NEUTRALS, TAILWIND_STEPS, type TailwindPalette, type TailwindSteps } from '@/state/tailwind-palettes';

/* Tailwind's neutrals but zinc: the theme's own grays are zinc already. */
export const PALETTE_NEUTRALS = TAILWIND_NEUTRALS.filter((name) => name !== 'zinc') as Exclude<(typeof TAILWIND_NEUTRALS)[number], 'zinc'>[];

/* The grounds a person can give the app: the theme's own grays first, then the neutrals and every color of
   Tailwind's scale, in its order. */
export const PALETTE_PRESETS = ['default', ...PALETTE_NEUTRALS, ...TAILWIND_COLORS] as const;

export type PalettePreset = (typeof PALETTE_PRESETS)[number];

/* How much color a ground of a colored palette carries at most. Tailwind's own darkest steps are far
   more saturated than a ground a person looks at all day should be; its neutrals stay as they are. */
const COLOR_GROUND_CHROMA = 0.04;

type NeutralToken = Exclude<PaletteToken, 'accent'>;

/*
 * The OKLCH lightness of the theme's own grays, per side. A tint keeps it, so every contrast the theme
 * was drawn with holds in every palette; `palette-presets.test.ts` checks the ones that carry text.
 * White cannot carry a hue, so the lightest surfaces step just below it, and muted text on the light
 * side is a step darker than the theme's, which falls just short of 4.5:1 on a sunken surface.
 */
const LIGHTNESS: Record<PaletteSide, Record<NeutralToken, number>> = {
    light: {
        bg: 0.967,
        surface: 0.993,
        'surface-raised': 0.993,
        'surface-sunken': 0.944,
        'surface-hover': 0.965,
        'surface-active': 0.896,
        separator: 0.922,
        text: 0.21,
        'text-muted': 0.5,
        'text-faint': 0.712,
        'canvas-bg': 0.95,
        'canvas-dot': 0.857,
        'term-bg': 0.985,
        'term-fg': 0.274
    },
    dark: {
        bg: 0.16,
        surface: 0.188,
        'surface-raised': 0.211,
        'surface-sunken': 0.135,
        'surface-hover': 0.245,
        'surface-active': 0.279,
        separator: 0.236,
        text: 0.945,
        'text-muted': 0.69,
        'text-faint': 0.49,
        'canvas-bg': 0.16,
        'canvas-dot': 0.245,
        'term-bg': 0.135,
        'term-fg': 0.878
    }
};

/* Text of a colored palette reads best close to gray, so it carries only a trace of the tint. */
const CHROMA_SHARE: Partial<Record<NeutralToken, number>> = {
    text: 0.2,
    'text-muted': 0.45,
    'text-faint': 0.45,
    'term-fg': 0.2
};

const toGamma = (value: number): number => (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);

/* OKLCH to a six-digit hex color. The chromas here are far inside sRGB, so clamping a channel never
   moves a hue. */
export function oklchHex(lightness: number, chroma: number, hue: number): string {
    const radians = (hue * Math.PI) / 180;
    const a = chroma * Math.cos(radians);
    const b = chroma * Math.sin(radians);
    const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const middle = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const channels = [
        4.0767416621 * long - 3.3077115913 * middle + 0.2309699292 * short,
        -1.2684380046 * long + 2.6097574011 * middle - 0.3413193965 * short,
        -0.0041960863 * long - 0.7034186147 * middle + 1.707614701 * short
    ];
    return `#${channels
        .map((value) =>
            Math.round(Math.min(1, Math.max(0, toGamma(value))) * 255)
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;
}

/* The chroma and hue a Tailwind scale has at a lightness, between the two steps around it, or at the
   end of the scale past either end. */
function tintAt(steps: TailwindSteps, lightness: number): { chroma: number; hue: number } {
    const lightest = steps[0]!;
    const darkest = steps[steps.length - 1]!;
    if (lightness >= lightest[0]) {
        return { chroma: lightest[1], hue: lightest[2] };
    }
    if (lightness <= darkest[0]) {
        return { chroma: darkest[1], hue: darkest[2] };
    }
    const upper = steps.findLastIndex((step) => step[0] >= lightness);
    const [highLightness, highChroma, highHue] = steps[upper]!;
    const [lowLightness, lowChroma, lowHue] = steps[upper + 1]!;
    const share = (highLightness - lightness) / (highLightness - lowLightness);
    // The short way round the wheel, so a scale that crosses zero does not sweep through every hue.
    const turn = ((((lowHue - highHue) % 360) + 540) % 360) - 180;
    return { chroma: highChroma + (lowChroma - highChroma) * share, hue: (highHue + turn * share + 360) % 360 };
}

function tintedTokens(palette: TailwindPalette | null, side: PaletteSide): PaletteSideInput {
    const lightness = LIGHTNESS[side];
    const colored = palette !== null && (TAILWIND_COLORS as readonly string[]).includes(palette);
    const tokens: PaletteSideInput = {};
    for (const token of Object.keys(lightness) as NeutralToken[]) {
        const tint = palette === null ? { chroma: 0, hue: 0 } : tintAt(TAILWIND_STEPS[palette], lightness[token]);
        const chroma = colored ? Math.min(tint.chroma, COLOR_GROUND_CHROMA) * (CHROMA_SHARE[token] ?? 1) : tint.chroma;
        tokens[token] = oklchHex(lightness[token], chroma, tint.hue);
    }
    return tokens;
}

/* The tokens a preset sets on one side. The default sets none, so the theme's own values stay exactly. */
export function presetTokens(preset: PalettePreset, side: PaletteSide): PaletteSideInput {
    return preset === 'default' ? {} : tintedTokens(preset, side);
}

/* What a preset looks like, for a sample drawn while another one is in use. The default is drawn as the
   grays it keeps, which no token on the page still holds once another palette is chosen. */
export function presetSample(preset: PalettePreset, side: PaletteSide): PaletteSideInput {
    return tintedTokens(preset === 'default' ? null : preset, side);
}

/* A preset as one round swatch: its color and a lighter step of it, split on the diagonal. The grounds
   themselves are too close to gray to tell apart at this size, so the swatch shows the scale they come
   from (500 and 300); the default shows the plain grays it keeps. The lighter half has a hairline edge,
   an alpha over its own color like every border, so it stands off a light ground; the darker half
   covers that edge on its side, since it stands off by itself. */
export function presetSwatch(preset: PalettePreset): string {
    const steps = TAILWIND_STEPS[preset === 'default' ? 'neutral' : preset];
    const [lighter, color] = [steps[3]!, steps[5]!].map(([lightness, chroma, hue]) => oklchHex(lightness, chroma, hue));
    return `linear-gradient(135deg, transparent 50%, ${color} 50%), radial-gradient(closest-side, transparent calc(100% - 1px), var(--border-strong) calc(100% - 1px)), ${lighter}`;
}

export function palettePresetFrom(stored: unknown): PalettePreset {
    return PALETTE_PRESETS.find((preset) => preset === stored) ?? 'default';
}
