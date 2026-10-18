import type { PaletteSide, PaletteSideInput, PaletteToken } from '@/state/palette';

/* The grounds a person can give the app. Neutral is the theme's own grays; every other one tints them. */
export const PALETTE_PRESETS = ['neutral', 'night', 'paper', 'forest', 'plum'] as const;

export type PalettePreset = (typeof PALETTE_PRESETS)[number];

/* A tint as an OKLCH hue and the chroma the grounds get at most. Low on purpose: a ground that shows its
   color loudly tires the eye over a working day and fights the accent. */
interface Tint {
    hue: number;
    chroma: number;
}

const TINTS: Record<Exclude<PalettePreset, 'neutral'>, Tint> = {
    night: { hue: 255, chroma: 0.035 },
    paper: { hue: 75, chroma: 0.03 },
    forest: { hue: 160, chroma: 0.03 },
    plum: { hue: 315, chroma: 0.035 }
};

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

/* Text reads best close to gray, so it carries only a trace of the tint the grounds have. */
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

function tintedTokens(tint: Tint, side: PaletteSide): PaletteSideInput {
    const lightness = LIGHTNESS[side];
    const tokens: PaletteSideInput = {};
    for (const token of Object.keys(lightness) as NeutralToken[]) {
        tokens[token] = oklchHex(lightness[token], tint.chroma * (CHROMA_SHARE[token] ?? 1), tint.hue);
    }
    return tokens;
}

/* The tokens a preset sets on one side. Neutral sets none, so the theme's own values stay exactly. */
export function presetTokens(preset: PalettePreset, side: PaletteSide): PaletteSideInput {
    return preset === 'neutral' ? {} : tintedTokens(TINTS[preset], side);
}

/* What a preset looks like, for a sample drawn while another one is in use. Neutral is drawn as the
   grays it keeps, which no token on the page still holds once a tint is chosen. */
export function presetSample(preset: PalettePreset, side: PaletteSide): PaletteSideInput {
    return tintedTokens(preset === 'neutral' ? { hue: 0, chroma: 0 } : TINTS[preset], side);
}

export function palettePresetFrom(stored: unknown): PalettePreset {
    return PALETTE_PRESETS.find((preset) => preset === stored) ?? 'neutral';
}
