import type { DrawingElement, DrawingFont } from '@ruimte/contracts';

/* A drawing sets its lines the way the app does: a little air, no leading of its own. */
export const LINE_HEIGHT = 1.25;

/* What each font name means outside the app, where the interface tokens do not exist. */
export const DEFAULT_FONT_STACKS: Record<DrawingFont, string> = {
    hand: 'Kalam, "Comic Sans MS", cursive',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
};

export type WrittenElement = DrawingElement & { kind: 'text' | 'note' };

/* How much paper a note keeps free around its text, on every side. */
export const NOTE_PADDING = 16;

/* The corners of a sheet of paper, which are never quite square. */
export const NOTE_RADIUS = 8;

/*
 * Where the glyphs of an element sit inside it: a note writes within its padding, a text is its
 * own box. Everything that lays out or measures a text goes through this, so both stay in step.
 */
export const writingFrameOf = (element: WrittenElement): { x: number; y: number; w: number } =>
    element.kind === 'note' ? { x: NOTE_PADDING, y: NOTE_PADDING, w: Math.max(1, element.w - NOTE_PADDING * 2) } : { x: 0, y: 0, w: element.w };

export const textLines = (text: string): string[] => text.split('\n');

export type MeasureLine = (line: string) => number;

/*
 * A measure for where no font exists, such as the daemon writing an SVG for an agent: a glyph is
 * a little over half its size wide, which is what most faces come to on average.
 */
export const approximateMeasure = (size: number, font: DrawingFont | undefined): MeasureLine => {
    const glyph = fontOf(font) === 'mono' ? 0.6 : 0.55;
    return (line) => line.length * size * glyph;
};

const wrapParagraph = (paragraph: string, maxWidth: number, measure: MeasureLine): string[] => {
    const lines: string[] = [];
    let line = '';
    const push = (): void => {
        lines.push(line);
        line = '';
    };
    for (const word of paragraph.split(' ')) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (measure(candidate) <= maxWidth) {
            line = candidate;
            continue;
        }
        if (line !== '') {
            push();
        }
        if (measure(word) <= maxWidth) {
            line = word;
            continue;
        }
        for (const glyph of word) {
            if (line !== '' && measure(line + glyph) > maxWidth) {
                push();
            }
            line += glyph;
        }
    }
    lines.push(line);
    return lines;
};

export const wrapLines = (text: string, maxWidth: number, measure: MeasureLine): string[] =>
    textLines(text).flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));

// An unsized text element follows its content; once sized, its box controls wrapping.
export const linesOf = (element: WrittenElement, measure: MeasureLine): string[] => {
    if (element.kind === 'note') {
        return wrapLines(element.text, writingFrameOf(element).w, measure);
    }
    return element.sized ? wrapLines(element.text, element.w, measure) : textLines(element.text);
};

/* Absent means hand: a drawing is written by hand unless it says otherwise. */
export const fontOf = (font: DrawingFont | undefined): DrawingFont => font ?? 'hand';
