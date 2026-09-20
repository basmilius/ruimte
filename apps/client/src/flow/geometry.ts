import type { FlowCard, FlowContent, FlowPort } from '@ruimte/contracts';
import { portsOf } from '@ruimte/flow';
import { portPoint, type Obstacle } from '@/canvas/edge-route';
import { unionOf, type Point, type Rect } from '@/canvas/math';

/* Wide enough for a sentence with two values in it, and the same for every card so a worksheet lines up. */
export const CARD_W = 236;
export const CARD_H = 76;

/* A note is a yellow sticker, so it is as wide as a card and as tall as a few lines. */
export const NOTE_H = 116;

export const cardRect = (card: FlowCard): Rect => ({ x: card.x, y: card.y, w: CARD_W, h: card.kind === 'note' ? NOTE_H : CARD_H });

export const cardRects = (content: FlowContent): Record<string, Rect> =>
    Object.fromEntries(Object.entries(content.cards).map(([id, card]) => [id, cardRect(card)]));

/* Every card as something a line has to stay clear of, which is what the router takes. */
export const obstaclesOf = (content: FlowContent): Obstacle[] => Object.entries(content.cards).map(([id, card]) => ({ id, ...cardRect(card) }));

export const boundsOf = (content: FlowContent, ids?: readonly string[]): Rect | null => {
    const rects = Object.entries(content.cards)
        .filter(([id]) => ids === undefined || ids.includes(id))
        .map(([, card]) => cardRect(card));
    return rects.length === 0 ? null : unionOf(rects);
};

/*
 * The slice of a card one of its ports speaks for. A card with two ports leaves by two points rather
 * than one, and handing the router this band instead of the whole card is what draws them apart.
 */
export const portBand = (rect: Rect, port: FlowPort, ports: readonly FlowPort[]): Rect => {
    const index = ports.indexOf(port);
    if (index < 0 || ports.length < 2) {
        return rect;
    }
    const height = rect.h / ports.length;
    return { ...rect, y: rect.y + index * height, h: height };
};

/* Where the dot of a port sits: a gap out from the right edge of its band. */
export const portDot = (card: FlowCard, port: FlowPort): Point => portPoint(portBand(cardRect(card), port, portsOf(card)), 'right');

/* Where a line lands: a gap out from the left edge, since a card has one way in. */
export const inputDot = (card: FlowCard): Point => portPoint(cardRect(card), 'left');
