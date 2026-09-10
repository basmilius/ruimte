import type { DrawingFont } from '@ruimte/contracts';

/* A drawing sets its lines the way the app does: a little air, no leading of its own. */
export const LINE_HEIGHT = 1.25;

/* What each font name means outside the app, where the interface tokens do not exist. */
export const DEFAULT_FONT_STACKS: Record<DrawingFont, string> = {
    hand: 'Kalam, "Comic Sans MS", cursive',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
};

export const textLines = (text: string): string[] => text.split('\n');

/* Absent means hand: a drawing is written by hand unless it says otherwise. */
export const fontOf = (font: DrawingFont | undefined): DrawingFont => font ?? 'hand';
