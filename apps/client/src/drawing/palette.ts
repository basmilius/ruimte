import { DRAWING_COLORS, type DrawingColor, type DrawingFont } from '@ruimte/contracts';
import { DEFAULT_FONT_STACKS } from '@ruimte/drawing';

export type DrawingPalette = Record<DrawingColor, string>;

/*
 * What every palette name is right now. A drawing names colors and the theme owns the values, so
 * the painter reads them once per render and again whenever the theme changes.
 */
const readColors = (prefix: string): DrawingPalette => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const palette = {} as DrawingPalette;
    for (const name of DRAWING_COLORS) {
        // Through `color` rather than the custom property itself: this way the value comes back
        // resolved, whatever chain of `var()` the token sits behind.
        probe.style.color = `var(--${prefix}-${name})`;
        palette[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return palette;
};

export const readPalette = (): DrawingPalette => readColors('draw');

/* The sheet a sticky note is written on, per palette name. */
export const readPaper = (): DrawingPalette => readColors('draw-paper');

/* The edge of that sheet: the same paper, a step deeper into its own color. */
export const readEdge = (): DrawingPalette => readColors('draw-edge');

const tokenValue = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const readCanvasBackground = (): string => tokenValue('--canvas-bg');

/* The three faces a text may be set in. A canvas needs a real stack, not the token that holds one. */
export const readFontStacks = (): Record<DrawingFont, string> => ({
    hand: DEFAULT_FONT_STACKS.hand,
    sans: tokenValue('--font-sans') || DEFAULT_FONT_STACKS.sans,
    mono: tokenValue('--font-mono') || DEFAULT_FONT_STACKS.mono
});
