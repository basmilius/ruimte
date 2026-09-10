import type { DrawingElement } from '@ruimte/contracts';
import { absolutePoints, boundsOf, centerOf, hitsElement, type Point } from './geometry.ts';

/* Two texts within this many units of each other are on the same line and read left to right. */
const ROW_TOLERANCE = 24;

/* How far from an arrow's end a label may sit and still be what the arrow points at. */
const LABEL_REACH = 48;

const labelOf = (element: DrawingElement): string | null => (element.kind === 'text' ? element.text.trim() || null : null);

/* A shape says what it is by the text inside it, which is how a box on a diagram is named. */
const labelInside = (element: DrawingElement, elements: readonly DrawingElement[]): string | null => {
    for (const candidate of elements) {
        if (candidate.kind !== 'text' || candidate.id === element.id) {
            continue;
        }
        const center = centerOf(boundsOf(candidate));
        if (hitsElement({ ...element, fill: 'solid' }, center, 0)) {
            return labelOf(candidate);
        }
    }
    return null;
};

/* What an arrow points at: the text at that end, or the shape there and the text it holds. */
const labelAt = (point: Point, elements: readonly DrawingElement[], arrowId: string): string | null => {
    let best: { label: string; distance: number } | null = null;
    for (const element of elements) {
        if (element.id === arrowId || element.kind === 'line' || element.kind === 'freehand') {
            continue;
        }
        const center = centerOf(boundsOf(element));
        const distance = Math.hypot(center.x - point.x, center.y - point.y);
        const inside = hitsElement({ ...element, fill: 'solid' }, point, LABEL_REACH);
        if (!inside && distance > LABEL_REACH) {
            continue;
        }
        const label = labelOf(element) ?? labelInside(element, elements);
        if (label && (!best || distance < best.distance)) {
            best = { label, distance };
        }
    }
    return best?.label ?? null;
};

/*
 * A drawing as lines an agent can read: the texts top to bottom and left to right, then every
 * arrow as the two things it connects. A diagram becomes a list without anyone looking at it.
 */
export const readingOrder = (elements: readonly DrawingElement[]): string[] => {
    const texts = elements
        .filter((element) => element.kind === 'text' && element.text.trim() !== '')
        .sort((left, right) => (Math.abs(left.y - right.y) <= ROW_TOLERANCE ? left.x - right.x : left.y - right.y))
        .map((element) => (element.kind === 'text' ? element.text.trim() : ''));

    const arrows: string[] = [];
    for (const element of elements) {
        if (element.kind !== 'line' || (!element.arrowEnd && !element.arrowStart)) {
            continue;
        }
        const points = absolutePoints(element);
        const from = labelAt(points[0]!, elements, element.id);
        const to = labelAt(points.at(-1)!, elements, element.id);
        if (!from || !to || from === to) {
            continue;
        }
        // An arrow that only has a head at its start reads the other way around.
        arrows.push(element.arrowEnd ? `${from} -> ${to}` : `${to} -> ${from}`);
    }
    return [...texts, ...arrows];
};
