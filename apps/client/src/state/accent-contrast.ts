import type { PaletteSide } from '@/state/palette';

/* The two colors text on an accent can take: white, and the theme's own near-black. */
const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#18181b';

/* The least contrast an accent needs as an icon or a focus ring on a ground (WCAG 1.4.11). */
const ON_SURFACE_CONTRAST = 3;

/* Tries of 5% each, mixing the accent toward black or white. */
const MIX_STEPS = 20;

/* The ground of each side in `@adecore/ui`'s theme, for a palette that sets none. */
export const THEME_SURFACE: Record<PaletteSide, string> = { light: '#ffffff', dark: '#131316' };

interface AccentContrast {
    /* The text on the accent: white or near-black, whichever measures higher. */
    text: string;
    /* The accent as text, an icon or a focus ring on the ground: the accent itself while it reaches 3:1, else the nearest mix toward black (light) or white (dark) that does. */
    onSurface: string;
}

function channelsOf(hex: string): [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hexOf(channels: readonly number[]): string {
    return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function luminanceOf(channels: readonly number[]): number {
    const [red, green, blue] = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

/* The WCAG contrast ratio of two six-digit hex colors. */
export function contrastOf(first: string, second: string): number {
    const [lighter, darker] = [luminanceOf(channelsOf(first)), luminanceOf(channelsOf(second))].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
}

/* Both colors are six-digit hex. Pure, so it is the same for a window, a test and the terminal. */
export function accentContrast(color: string, surface: string, side: PaletteSide): AccentContrast {
    const text = contrastOf(color, LIGHT_TEXT) >= contrastOf(color, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;

    if (contrastOf(color, surface) >= ON_SURFACE_CONTRAST) {
        return { text, onSurface: color };
    }

    const target = channelsOf(side === 'light' ? '#000000' : '#ffffff');
    const channels = channelsOf(color);

    let mixed = color;

    // The last step is the target itself, so the loop ends even on a ground nothing reaches.
    for (let step = 1; step <= MIX_STEPS; step++) {
        mixed = hexOf(channels.map((channel, i) => channel + (target[i]! - channel) * (step / MIX_STEPS)));

        if (contrastOf(mixed, surface) >= ON_SURFACE_CONTRAST) {
            break;
        }
    }

    return { text, onSurface: mixed };
}
