import type { DrawingFont } from '@ruimte/contracts';

/* Absent is 'sans', so a label written before there was a choice keeps the face it had. */
export const FONT_STACK: Record<DrawingFont, string> = {
    hand: 'var(--font-hand)',
    sans: 'var(--font-sans)',
    mono: 'var(--font-mono)'
};
