import { DRAWING_COLORS, type DrawingColor, type DrawingFont } from '@ruimte/contracts';
import { DEFAULT_FONT_STACKS } from '@adecore/drawing';

export type DrawingPalette = Record<DrawingColor, string>;

/*
 * What every palette name is right now. A drawing names colors and the theme owns the values, so
 * the painter reads them once per render and again whenever the theme changes.
 */
function readColors(prefix: string): DrawingPalette {
    const colors = resolveColors(DRAWING_COLORS.map((name) => `--${prefix}-${name}`));
    return Object.fromEntries(DRAWING_COLORS.map((name, i) => [name, colors[i]!])) as DrawingPalette;
}

function resolveColors(tokens: readonly string[]): string[] {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    // Through `color` rather than the custom property itself: this way the value comes back resolved,
    // whatever chain of `var()` or `color-mix()` the token sits behind.
    const colors = tokens.map((token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
    });
    probe.remove();
    return colors;
}

export function readPalette(): DrawingPalette {
    return readColors('draw');
}

/* The sheet a sticky note is written on, per palette name. */
export function readPaper(): DrawingPalette {
    return readColors('draw-paper');
}

/* The edge of that sheet: the same paper, a step deeper into its own color. */
export function readEdge(): DrawingPalette {
    return readColors('draw-edge');
}

function tokenValue(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* The ground an export is filled with. Resolved like the palette: the raw token may be a mix that a
   canvas's `fillStyle` and an SVG's background do not take. */
export function readCanvasBackground(): string {
    return resolveColors(['--canvas-bg'])[0]!;
}

/* The three faces a text may be set in. A canvas needs a real stack, not the token that holds one. */
export function readFontStacks(): Record<DrawingFont, string> {
    return {
        hand: DEFAULT_FONT_STACKS.hand,
        sans: tokenValue('--font-sans') || DEFAULT_FONT_STACKS.sans,
        mono: tokenValue('--font-mono') || DEFAULT_FONT_STACKS.mono
    };
}
