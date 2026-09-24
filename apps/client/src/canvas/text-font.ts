import type { DrawingFont } from '@ruimte/contracts';

/* A text without a font reads as 'sans', the face every label had before there was a choice. */
export const FONT_STACK: Record<DrawingFont, string> = {
    hand: 'var(--font-hand)',
    sans: 'var(--font-sans)',
    mono: 'var(--font-mono)'
};
