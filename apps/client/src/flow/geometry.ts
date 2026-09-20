import type { FlowCard, FlowContent, FlowPort } from '@ruimte/contracts';
import { argApplies, argsOf, portsOf } from '@ruimte/flow';
import { portPoint, type Obstacle } from '@/canvas/edge-route';
import { unionOf, type Point, type Rect } from '@/canvas/math';

/*
 * Wide enough for a sentence with two controls in it, and the same for every card so a worksheet
 * lines up. A value is filled in on the card itself, so a value is a control and not a word, and
 * the card carries the room that takes.
 */
export const CARD_W = 360;

/* Two lines of sentence beside the source icon, which is what most cards say. */
export const CARD_H = 88;

/* What one more line of sentence adds. A whole number of grid steps, so a taller card still snaps. */
const SENTENCE_LINE = 24;

/*
 * How tall a card with a sentence on it is. A control takes more room than the word it replaced, so
 * from the third one on the sentence gets a line per control. It follows from what the card asks
 * for and never from measuring it: the router works on rectangles, and a measured height would make
 * the lines between two cards depend on the font a person reads them in, or on the language.
 */
export const cardHeight = (card: FlowCard): number => {
    const controls = argsOf(card).filter((arg) => argApplies(card, arg)).length;
    return CARD_H + SENTENCE_LINE * Math.max(0, controls - 2);
};

/*
 * A card about the graph itself carries a word and no sentence, so it is a pill rather than a card.
 * Its width is fixed and not measured: the router works on rectangles, and a width that came out of
 * the DOM would make the lines between two cards depend on the font a person reads them in.
 */
export const PILL_W = 176;
export const PILL_H = 48;

/* The start card is the icon and nothing else, so it is a circle as wide as a card is high. */
export const START_SIZE = CARD_H;

/* A note is a yellow sticker, so it is as wide as a card and as tall as a few lines. */
export const NOTE_H = 116;

/* The round plate the source icon sits in, on the left of every card that carries a sentence. */
export const ICON_SIZE = 40;

const sizeOf = (card: FlowCard): { w: number; h: number } => {
    switch (card.kind) {
        case 'start':
            return { w: START_SIZE, h: START_SIZE };
        case 'delay':
        case 'any':
        case 'all':
            return { w: PILL_W, h: PILL_H };
        case 'note':
            return { w: CARD_W, h: NOTE_H };
        default:
            return { w: CARD_W, h: cardHeight(card) };
    }
};

export const cardRect = (card: FlowCard): Rect => ({ x: card.x, y: card.y, ...sizeOf(card) });

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
 * How round either end of a card is. A trigger is a capsule where a run begins and a plain box where
 * it leaves, a condition is a capsule on both ends because it asks something, and an action is a box
 * that does. That is what tells the three apart on a full worksheet without reading a word of them,
 * and it works for anyone who reads color poorly.
 */
export interface CardRounding {
    left: number;
    right: number;
}

/* The radius that makes an end a half circle rather than a rounded corner. */
const capsule = (h: number): number => h / 2;

/* Every other end, in the radius the rest of the interface uses for a box this size. */
const BOX_RADIUS = 10;

export const roundingOf = (card: FlowCard): CardRounding => {
    const { h } = sizeOf(card);
    switch (card.kind) {
        case 'trigger':
            return { left: capsule(h), right: BOX_RADIUS };
        case 'condition':
        case 'delay':
        case 'any':
            return { left: capsule(h), right: capsule(h) };
        case 'all':
            return { left: capsule(h), right: BOX_RADIUS };
        case 'start':
            return { left: capsule(h), right: capsule(h) };
        default:
            return { left: BOX_RADIUS, right: BOX_RADIUS };
    }
};

/*
 * How far inside its box the edge of a card lies at this height. A rounded end curves away from the
 * corners, so a port band taken straight off the box would have its line start in mid air beside a
 * capsule, or worse, inside it.
 */
export const edgeInset = (h: number, radius: number, dy: number): number => {
    const straight = h / 2 - radius;
    const past = Math.abs(dy) - straight;
    if (past <= 0) {
        return 0;
    }
    return radius - Math.sqrt(Math.max(0, radius * radius - Math.min(past, radius) ** 2));
};

/*
 * The slice of a card one of its ports speaks for. A card with two ports leaves by two points rather
 * than one, and handing the router this band instead of the whole card is what draws them apart. The
 * band stops where the card really ends, so a port beside a capsule sits on the curve and not beside it.
 */
export const portBand = (rect: Rect, port: FlowPort, ports: readonly FlowPort[], rounding: CardRounding): Rect => {
    const index = ports.indexOf(port);
    const height = ports.length < 2 ? rect.h : rect.h / ports.length;
    const y = index < 0 || ports.length < 2 ? rect.y : rect.y + index * height;
    const middle = y + height / 2;
    const inset = edgeInset(rect.h, rounding.right, middle - (rect.y + rect.h / 2));
    return { x: rect.x, y, w: rect.w - inset, h: height };
};

export const bandOf = (card: FlowCard, port: FlowPort): Rect => portBand(cardRect(card), port, portsOf(card), roundingOf(card));

/* Where the dot of a port sits: a gap out from the right edge of its band. */
export const portDot = (card: FlowCard, port: FlowPort): Point => portPoint(bandOf(card, port), 'right');

/* Where a line lands: a gap out from the left edge, since a card has one way in. */
export const inputDot = (card: FlowCard): Point => portPoint(cardRect(card), 'left');
