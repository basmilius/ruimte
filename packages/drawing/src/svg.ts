import type { DrawingColor, DrawingElement, DrawingFont } from '@ruimte/contracts';
import { boundsOfElements, centerOf, boundsOf, type Rect } from './geometry.ts';
import { pathsOfElement } from './paths.ts';
import { DEFAULT_FONT_STACKS, LINE_HEIGHT, approximateMeasure, fontOf, linesOf, writingFrameOf, type MeasureLine, type WrittenElement } from './text.ts';

export interface SvgOptions {
    /* What every palette name is in the theme this export is made in. */
    palette: Record<DrawingColor, string>;
    /* The paper behind the drawing, or null for a transparent one. */
    background?: string | null;
    /* World units around the drawing, so nothing touches the edge. */
    margin?: number;
    fonts?: Partial<Record<DrawingFont, string>>;
    /* The paper of a note per palette name; without it the light theme's sheets are used. */
    paper?: Record<DrawingColor, string>;
    /* The edge of that paper, which is the sheet a step deeper into its own color. */
    edge?: Record<DrawingColor, string>;
    /* How wide a line is in the given text, for wrapping a sized text; without it a glyph is estimated. */
    measure?: (element: WrittenElement) => MeasureLine;
}

export const DEFAULT_SVG_MARGIN = 32;

/*
 * What the palette names are worth where no theme is loaded (an export read outside the app, the
 * daemon rendering a drawing for an agent): the values of the light theme in `styles.css`.
 */
export const DEFAULT_PALETTE: Record<DrawingColor, string> = {
    ink: '#18181b',
    muted: '#6f6f78',
    accent: '#4f46e5',
    red: '#d64545',
    orange: '#d97706',
    yellow: '#b7860b',
    green: '#2f8a4f',
    blue: '#2563eb',
    purple: '#7c3aed',
    pink: '#db2777'
};

/* The paper a note is written on outside the app, the values of the light theme in `styles.css`. */
export const DEFAULT_PAPER: Record<DrawingColor, string> = {
    ink: '#f4f4f6',
    muted: '#ececef',
    accent: '#e2e5fd',
    red: '#fddfdf',
    orange: '#fde9d0',
    yellow: '#fff3bf',
    green: '#dcf5e3',
    blue: '#dbe9ff',
    purple: '#eadffb',
    pink: '#fde2ea'
};

/* The edge of that paper outside the app: every sheet above, a step deeper into its own color. */
export const DEFAULT_EDGE: Record<DrawingColor, string> = {
    ink: '#dedee2',
    muted: '#d6d6da',
    accent: '#c3cbf7',
    red: '#f4bebe',
    orange: '#f3d3a8',
    yellow: '#f0dc94',
    green: '#b9e3c6',
    blue: '#b6cff2',
    purple: '#d5bef0',
    pink: '#f3c0d1'
};

const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const round = (value: number): number => Math.round(value * 100) / 100;

const transformOf = (element: DrawingElement): string => {
    const center = centerOf(boundsOf(element));
    const turn = element.angle ? ` rotate(${round((element.angle * 180) / Math.PI)} ${round(center.x)} ${round(center.y)})` : '';
    return `translate(${round(element.x)} ${round(element.y)})${turn}`;
};

const textSvg = (element: WrittenElement, options: SvgOptions): string => {
    const family = options.fonts?.[fontOf(element.font)] ?? DEFAULT_FONT_STACKS[fontOf(element.font)];
    const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
    const frame = writingFrameOf(element);
    const dx = frame.x + (element.align === 'center' ? frame.w / 2 : element.align === 'right' ? frame.w : 0);
    const measure = options.measure?.(element) ?? approximateMeasure(element.size, element.font);
    const lines = linesOf(element, measure)
        .map((line, index) => `<tspan x="${round(dx)}" y="${round(frame.y + (index + 0.8) * element.size * LINE_HEIGHT)}">${escapeXml(line)}</tspan>`)
        .join('');
    return `<text font-family="${escapeXml(family)}" font-size="${element.size}" fill="${options.palette[element.stroke]}" text-anchor="${anchor}">${lines}</text>`;
};

const elementSvg = (element: DrawingElement, options: SvgOptions): string => {
    const note = element.kind === 'note';
    const paper = options.paper ?? DEFAULT_PAPER;
    const edge = options.edge ?? DEFAULT_EDGE;
    const body =
        element.kind === 'text'
            ? textSvg(element, options)
            : pathsOfElement(element)
                  .map((path) => {
                      const dash = path.dash ? ` stroke-dasharray="${path.dash.join(' ')}"` : '';
                      if (path.role === 'stroke') {
                          const line = note ? edge[element.fillColor ?? element.stroke] : options.palette[element.stroke];
                          return `<path d="${path.d}" fill="none" stroke="${line}" stroke-width="${path.strokeWidth}" stroke-linecap="round"${dash}/>`;
                      }
                      // A note is filled with its paper, which is a palette of pale sheets of its own.
                      const fill = note ? paper : options.palette;
                      const color = path.role === 'ink' ? options.palette[element.stroke] : fill[element.fillColor ?? element.stroke];
                      // A hachure fill is a bundle of lines, so it arrives as a stroke with its own width.
                      return path.strokeWidth > 0 && path.role === 'fill' && element.fill === 'hachure'
                          ? `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"/>`
                          : `<path d="${path.d}" fill="${color}" stroke="none"/>`;
                  })
                  .join('');
    // The paper is drawn first and the note's own words go on top of it.
    const written = note ? textSvg(element, options) : '';
    return `<g transform="${transformOf(element)}">${body}${written}</g>`;
};

/*
 * The whole drawing as one SVG, in the colors of the theme it is exported from. Fonts are named,
 * never embedded: a file that opens outside the app falls back to a system face.
 */
export const toSvg = (elements: readonly DrawingElement[], options: SvgOptions): string => {
    const margin = options.margin ?? DEFAULT_SVG_MARGIN;
    const bounds: Rect = boundsOfElements(elements) ?? { x: 0, y: 0, w: 1, h: 1 };
    const x = round(bounds.x - margin);
    const y = round(bounds.y - margin);
    const w = round(bounds.w + margin * 2);
    const h = round(bounds.h + margin * 2);
    const paper = options.background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${options.background}"/>` : '';
    const body = elements.map((element) => elementSvg(element, options)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${paper}${body}</svg>`;
};
