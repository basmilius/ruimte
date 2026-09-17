import type { DrawingElement } from '@ruimte/contracts';
import { getStroke } from 'perfect-freehand';
import { RoughGenerator } from 'roughjs/bin/generator';
import type { Options } from 'roughjs/bin/core';
import { arrowHead, arrowHeadSize, type Point } from './geometry.ts';
import { NOTE_RADIUS } from './text.ts';

/*
 * What a painter has to do with one path. The colors are not in here: a drawing names palette
 * colors and the painter resolves them against the theme it is drawing in.
 */
export interface ElementPath {
    d: string;
    /* `stroke` outlines in the stroke color, `fill` fills in the fill color, `ink` fills in the stroke color. */
    role: 'stroke' | 'fill' | 'ink';
    strokeWidth: number;
    /* Whole units on and off, or null for a solid line. */
    dash: number[] | null;
}

// Sentinels, not colors: rough hands them back on every path, which is how a path says what it is.
const STROKE = '#000001';
const FILL = '#000002';

const generator = new RoughGenerator();

const dashOf = (element: DrawingElement): number[] | null => {
    if (element.strokeStyle === 'dashed') {
        return [element.strokeWidth * 4, element.strokeWidth * 4];
    }
    if (element.strokeStyle === 'dotted') {
        return [element.strokeWidth, element.strokeWidth * 3];
    }
    return null;
};

/* Architect, Artist, Cartoonist. Absent reads as Artist, which is what a hand-written file gets. */
const roughnessOf = (element: DrawingElement): Pick<Options, 'roughness' | 'bowing' | 'disableMultiStroke'> => {
    switch (element.roughness ?? 1) {
        case 0:
            return { roughness: 0, bowing: 0, disableMultiStroke: true };
        case 2:
            return { roughness: 2.5, bowing: 2 };
        default:
            return { roughness: 1, bowing: 1 };
    }
};

const optionsOf = (element: DrawingElement): Options => ({
    seed: element.seed + 1,
    stroke: STROKE,
    strokeWidth: element.strokeWidth,
    ...roughnessOf(element),
    ...(element.fill && element.fill !== 'none'
        ? { fill: FILL, fillStyle: element.fill === 'solid' ? 'solid' : 'hachure', fillWeight: element.strokeWidth / 2, hachureGap: 8 }
        : {})
});

// Rough has no rounded-rectangle primitive.
const roundedRectPath = (w: number, h: number, radius: number): string => {
    const r = Math.min(radius, w / 2, h / 2);
    return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
};

export const outlineToPath = (outline: readonly (readonly number[])[]): string => {
    if (outline.length === 0) {
        return '';
    }
    const [first, ...rest] = outline;
    return `M ${first![0]} ${first![1]} ${rest.map((point) => `L ${point[0]} ${point[1]}`).join(' ')} Z`;
};

export const freehandOutline = (element: DrawingElement & { kind: 'freehand' }): string => {
    const points = element.points.map(([x, y, pressure]) => [x, y, pressure ?? 0.5] as [number, number, number]);
    const outline = getStroke(points, {
        size: element.strokeWidth * 4 + 2,
        thinning: 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        // A pressure of exactly 0.5 on every point is a mouse; the stroke gets its taper from speed.
        simulatePressure: element.points.every((point) => point[2] === undefined)
    });
    return outlineToPath(outline);
};

const linesToPath = (segments: readonly [Point, Point][]): string => segments.map(([from, to]) => `M ${from.x} ${from.y} L ${to.x} ${to.y}`).join(' ');

/*
 * One element as paths in its own frame: the origin is the element's own (x, y), so the painter
 * translates and turns, and a path can be cached until the element's shape itself changes.
 */
export const pathsOfElement = (element: DrawingElement): ElementPath[] => {
    if (element.kind === 'text') {
        return [];
    }
    // A note is a sheet of paper, not a drawn shape: no wobble, and an edge of its own paper color.
    if (element.kind === 'note') {
        const d = roundedRectPath(element.w, element.h, NOTE_RADIUS);
        return [
            { d, role: 'fill', strokeWidth: 0, dash: null },
            { d, role: 'stroke', strokeWidth: element.strokeWidth, dash: null }
        ];
    }
    const options = optionsOf(element);
    const dash = dashOf(element);
    if (element.kind === 'freehand') {
        return [{ d: freehandOutline(element), role: 'ink', strokeWidth: 0, dash: null }];
    }
    const drawable = (() => {
        switch (element.kind) {
            case 'rect':
                return element.radius
                    ? generator.path(roundedRectPath(element.w, element.h, element.radius), options)
                    : generator.rectangle(0, 0, element.w, element.h, options);
            case 'diamond':
                return generator.polygon(
                    [
                        [element.w / 2, 0],
                        [element.w, element.h / 2],
                        [element.w / 2, element.h],
                        [0, element.h / 2]
                    ],
                    options
                );
            case 'ellipse':
                return generator.ellipse(element.w / 2, element.h / 2, element.w, element.h, options);
            case 'line':
                return generator.linearPath(
                    element.points.map(([x, y]) => [x, y] as [number, number]),
                    options
                );
        }
    })();
    const paths: ElementPath[] = generator.toPaths(drawable).map((path) => ({
        d: path.d,
        role: path.fill === FILL ? 'fill' : path.stroke === FILL ? 'fill' : 'stroke',
        strokeWidth: path.strokeWidth,
        dash: path.stroke === STROKE ? dash : null
    }));
    if (element.kind !== 'line') {
        return paths;
    }
    const points = element.points.map(([x, y]) => ({ x, y }));
    const size = arrowHeadSize(element.strokeWidth);
    const heads: [Point, Point][] = [
        ...(element.arrowEnd ? arrowHead(points.at(-1)!, points.at(-2)!, size) : []),
        ...(element.arrowStart ? arrowHead(points[0]!, points[1]!, size) : [])
    ];
    // The head is always solid: a dashed arrow still points at something.
    return heads.length === 0 ? paths : [...paths, { d: linesToPath(heads), role: 'stroke', strokeWidth: element.strokeWidth, dash: null }];
};
