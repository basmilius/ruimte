import type { DrawingElement, DrawingFont } from '@ruimte/contracts';

/* A drawing sets its lines the way the app does: a little air, no leading of its own. */
export const LINE_HEIGHT = 1.25;

/* What each font name means outside the app, where the interface tokens do not exist. */
export const DEFAULT_FONT_STACKS: Record<DrawingFont, string> = {
    hand: 'Kalam, "Comic Sans MS", cursive',
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
};

export const textLines = (text: string): string[] => text.split('\n');

/* The width of one line in world units, in the font the caller has. */
export type MeasureLine = (line: string) => number;

/*
 * A measure for where no font exists, such as the daemon writing an SVG for an agent: a glyph is
 * a little over half its size wide, which is what most faces come to on average.
 */
export const approximateMeasure = (size: number, font: DrawingFont | undefined): MeasureLine => {
    const glyph = fontOf(font) === 'mono' ? 0.6 : 0.55;
    return (line) => line.length * size * glyph;
};

/* One paragraph on as many lines as the width allows; a word that is too long breaks between glyphs. */
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

/* The text broken at the box's width; a hard line break always breaks, and an empty paragraph stays a line. */
export const wrapLines = (text: string, maxWidth: number, measure: MeasureLine): string[] =>
    textLines(text).flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));

/* The lines a text element is set on: broken at its box once that box is the person's, else as typed. */
export const linesOf = (element: DrawingElement & { kind: 'text' }, measure: MeasureLine): string[] =>
    element.sized ? wrapLines(element.text, element.w, measure) : textLines(element.text);

/* Absent means hand: a drawing is written by hand unless it says otherwise. */
export const fontOf = (font: DrawingFont | undefined): DrawingFont => font ?? 'hand';
