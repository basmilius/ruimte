import { create } from 'zustand';

/*
 * The colors a person's choices put over the theme's own, per side. They are a stylesheet of their own,
 * the rule after the theme that `@adecore/ui` asks an app for, rather than values inline on the root:
 * an inline value is one for both sides, and every subtree that sets a side of its own (the samples in
 * the settings, a code preview) would declare the theme's values again under it.
 */

export type PaletteSide = 'light' | 'dark';

/* What one side may set. A token the theme derives from these (the soft accent, the selection, the
   terminal's cursor) follows by itself. */
export interface PaletteSideInput {
    accent?: string;
}

export type PaletteInput = Record<PaletteSide, PaletteSideInput>;

/* Only a six-digit hex color reaches the stylesheet: the terminal and the desktop shell read these tokens
   back as literal colors, and a value that is not one is never written as text into a rule. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const SIDES: readonly PaletteSide[] = ['light', 'dark'];

/* A color as channels, for the tokens that carry it with an alpha: `rgb(var(--accent-rgb) / a)`. */
export function channelsOf(hex: string): string {
    const value = Number.parseInt(hex.slice(1), 16);
    return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

function declarationsOf(side: PaletteSideInput): string[] {
    const declarations: string[] = [];
    if (side.accent !== undefined && HEX_COLOR.test(side.accent)) {
        declarations.push(`--accent: ${side.accent};`, `--accent-rgb: ${channelsOf(side.accent)};`);
    }
    return declarations;
}

/*
 * The stylesheet for a palette. The attribute is named twice to weigh twice the theme's own blocks, so
 * the order in which the stylesheets reach the document never decides, while it still matches every
 * element that carries a side.
 */
export function paletteCss(input: PaletteInput): string {
    return SIDES.flatMap((side) => {
        const declarations = declarationsOf(input[side]);
        if (declarations.length === 0) {
            return [];
        }
        return [`[data-theme='${side}'][data-theme] {\n${declarations.map((line) => `    ${line}`).join('\n')}\n}`];
    }).join('\n');
}

interface PaletteState {
    /* Counts every change of the palette's colors, so what paints with them (a drawing on a canvas
       element, the window behind the page) knows to read them again. */
    revision: number;
}

export const usePalette = create<PaletteState>(() => ({ revision: 0 }));

const STYLE_ID = 'ruimte-palette';

/* Writes the palette over the theme. Nothing happens while the stylesheet already says the same. */
export function applyPalette(input: PaletteInput): void {
    // A test that reads the settings for their defaults has no document to write into.
    if (typeof document === 'undefined') {
        return;
    }
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    const css = paletteCss(input);
    if (style.textContent === css) {
        return;
    }
    style.textContent = css;
    const revision = usePalette.getState().revision + 1;
    // The terminal and a chat's visuals watch the root's attributes and not the stylesheets, so the root
    // carries the revision too: the change of its `style` is what has them read the tokens again.
    document.documentElement.style.setProperty('--palette-revision', String(revision));
    usePalette.setState({ revision });
}
