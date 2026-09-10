import type { DrawingColor, DrawingElement, DrawingFont } from '@ruimte/contracts';
import { boundsOfElements, centerOf, boundsOf, type Rect } from './geometry.ts';
import { pathsOfElement } from './paths.ts';
import { DEFAULT_FONT_STACKS, LINE_HEIGHT, approximateMeasure, fontOf, linesOf, type MeasureLine } from './text.ts';

export interface SvgOptions {
    /* What every palette name is in the theme this export is made in. */
    palette: Record<DrawingColor, string>;
    /* The paper behind the drawing, or null for a transparent one. */
    background?: string | null;
    /* World units around the drawing, so nothing touches the edge. */
    margin?: number;
    fonts?: Partial<Record<DrawingFont, string>>;
    /* How wide a line is in the given text, for wrapping a sized text; without it a glyph is estimated. */
    measure?: (element: DrawingElement & { kind: 'text' }) => MeasureLine;
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

const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const round = (value: number): number => Math.round(value * 100) / 100;

const transformOf = (element: DrawingElement): string => {
    const center = centerOf(boundsOf(element));
    const turn = element.angle ? ` rotate(${round((element.angle * 180) / Math.PI)} ${round(center.x)} ${round(center.y)})` : '';
    return `translate(${round(element.x)} ${round(element.y)})${turn}`;
};

const textSvg = (element: DrawingElement & { kind: 'text' }, options: SvgOptions): string => {
    const family = options.fonts?.[fontOf(element.font)] ?? DEFAULT_FONT_STACKS[fontOf(element.font)];
    const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
    const dx = element.align === 'center' ? element.w / 2 : element.align === 'right' ? element.w : 0;
    const measure = options.measure?.(element) ?? approximateMeasure(element.size, element.font);
    const lines = linesOf(element, measure)
        .map((line, index) => `<tspan x="${round(dx)}" y="${round((index + 0.8) * element.size * LINE_HEIGHT)}">${escapeXml(line)}</tspan>`)
        .join('');
    return `<text font-family="${escapeXml(family)}" font-size="${element.size}" fill="${options.palette[element.stroke]}" text-anchor="${anchor}">${lines}</text>`;
};

const elementSvg = (element: DrawingElement, options: SvgOptions): string => {
    const body =
        element.kind === 'text'
            ? textSvg(element, options)
            : pathsOfElement(element)
                  .map((path) => {
                      const dash = path.dash ? ` stroke-dasharray="${path.dash.join(' ')}"` : '';
                      if (path.role === 'stroke') {
                          return `<path d="${path.d}" fill="none" stroke="${options.palette[element.stroke]}" stroke-width="${path.strokeWidth}" stroke-linecap="round"${dash}/>`;
                      }
                      const color = path.role === 'ink' ? options.palette[element.stroke] : options.palette[element.fillColor ?? element.stroke];
                      // A hachure fill is a bundle of lines, so it arrives as a stroke with its own width.
                      return path.strokeWidth > 0 && path.role === 'fill' && element.fill === 'hachure'
                          ? `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"/>`
                          : `<path d="${path.d}" fill="${color}" stroke="none"/>`;
                  })
                  .join('');
    return `<g transform="${transformOf(element)}">${body}</g>`;
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
