import { create } from 'zustand';

/*
 * The colors a person's choices put over the theme's own, per side. They are a stylesheet of their own,
 * the rule after the theme that `@adecore/ui` asks an app for, rather than values inline on the root:
 * an inline value is one for both sides, and every subtree that sets a side of its own (the samples in
 * the settings, a code preview) would declare the theme's values again under it.
 */

export type PaletteSide = 'light' | 'dark';

/* The tokens a palette may set, by their names without the dashes. A token the theme derives from
   these (the soft accent, the selection, the terminal's cursor, the lines on a canvas) follows by itself. */
export const PALETTE_TOKENS = [
    'accent',
    'bg',
    'surface',
    'surface-raised',
    'surface-sunken',
    'surface-hover',
    'surface-active',
    'separator',
    'text',
    'text-muted',
    'text-faint',
    'canvas-bg',
    'canvas-dot',
    'term-bg',
    'term-fg'
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];

/* What one side sets. A token it leaves out keeps the theme's own value. */
export type PaletteSideInput = Partial<Record<PaletteToken, string>>;

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
    for (const token of PALETTE_TOKENS) {
        const value = side[token];
        if (value === undefined || !HEX_COLOR.test(value)) {
            continue;
        }
        declarations.push(`--${token}: ${value};`);
        if (token === 'accent') {
            declarations.push(`--accent-rgb: ${channelsOf(value)};`);
        }
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
    /* Whether the colors are a preview of ones not picked yet. The window behind the page keeps the picked
       ones meanwhile: the desktop shell gives every window the ground one window reports. */
    previewing: boolean;
}

export const usePalette = create<PaletteState>(() => ({ revision: 0, previewing: false }));

const STYLE_ID = 'ruimte-palette';

/* How long a preview has to stay before what paints outside the stylesheet (every terminal, every
   drawing) follows it. A pointer that sweeps a wheel passes many swatches; only the one it rests on is
   worth a repaint of all of them. */
const PREVIEW_SETTLE_MS = 60;

let settling: ReturnType<typeof setTimeout> | null = null;

function nextRevision(previewing: boolean): void {
    const revision = usePalette.getState().revision + 1;
    // The terminal and a chat's visuals watch the root's attributes and not the stylesheets, so the root
    // carries the revision too: the change of its `style` is what has them read the tokens again.
    document.documentElement.style.setProperty('--palette-revision', String(revision));
    usePalette.setState({ revision, previewing });
}

/* Writes the palette over the theme, as the picked colors or as a preview of others. Nothing changes
   while the stylesheet already says the same. */
export function applyPalette(input: PaletteInput, options: { preview?: boolean } = {}): void {
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
    const changed = style.textContent !== css;
    if (changed) {
        style.textContent = css;
    }
    if (settling !== null) {
        clearTimeout(settling);
        settling = null;
    }
    if (options.preview === true) {
        if (!usePalette.getState().previewing) {
            usePalette.setState({ previewing: true });
        }
        if (changed) {
            settling = setTimeout(() => {
                settling = null;
                nextRevision(true);
            }, PREVIEW_SETTLE_MS);
        }
        return;
    }
    // The picked colors, or the end of a preview: everything follows at once.
    if (changed) {
        nextRevision(false);
    } else if (usePalette.getState().previewing) {
        usePalette.setState({ previewing: false });
    }
}
