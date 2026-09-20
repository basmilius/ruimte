import type { FlowCard, FlowContent, FlowPort } from '@ruimte/contracts';
import { argApplies, argsOf, numberArg, portsOf } from '@ruimte/flow';
import { portPoint, type Obstacle } from '@/canvas/edge-route';
import { GRID, unionOf, type Point, type Rect } from '@/canvas/math';

/*
 * Wide enough for a sentence with two controls in it, and the same for every card so a worksheet
 * lines up. A value is filled in on the card itself, so a value is a control and not a word, and
 * the card carries the room that takes.
 */
export const CARD_W = 340;

/* Two lines of sentence beside the source icon, which is what most cards say. */
export const CARD_H = 88;

/* What one more line of sentence adds. A whole number of grid steps, so a taller card still snaps. */
const SENTENCE_LINE = 24;

/* The round plate the source icon sits in, on the left of every card. */
export const ICON_SIZE = 40;

/* The air around what a card holds, and the gap between the plate and the words beside it. */
const PADDING = 8;
const GAP = 8;

/* A wait carries a sentence rather than a word, and it is given a little more room to end on. */
const WAIT_PADDING = 12;

/* The circle the start card is: the plate with less air around it than a card of words needs. */
const START_PADDING = 4;
export const START_SIZE = ICON_SIZE + START_PADDING * 2;

/* A card about the graph itself is the plate and a word, so it is one row high and no more. */
export const CHIP_H = ICON_SIZE + PADDING * 2;

/*
 * The room the word on such a card gets, in characters. A join says one word and a wait says a short
 * sentence with a number in it.
 */
const JOIN_ROOM = 9;
const WAIT_ROOM = 13;

/* What a character takes at the size a card is read in. */
const CHAR_W = 7;

/* A note is a yellow sticker, so it is as wide as a card and as tall as a few lines. */
export const NOTE_H = 116;

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

/* Up to the grid the cards snap to, so a chip lines up with everything else on the worksheet. */
const snapUp = (value: number): number => Math.ceil(value / GRID) * GRID;

/*
 * How wide a card about the graph itself is. It says one word, so it is a chip beside the cards that
 * carry a sentence rather than a block half their width. The room for that word is worked out from
 * the card and never measured: the router works on rectangles, and a width taken from the DOM would
 * make the lines between two cards depend on the font they are read in. A word that outgrows its
 * room is cut, the way every other label in the interface is.
 */
export const chipWidth = (card: FlowCard): number => {
    const wait = card.kind === 'delay';
    const room = wait ? WAIT_ROOM + String(numberArg(card, 'amount', 0)).length : JOIN_ROOM;
    return snapUp(PADDING + ICON_SIZE + GAP + room * CHAR_W + (wait ? WAIT_PADDING : PADDING));
};

const sizeOf = (card: FlowCard): { w: number; h: number } => {
    switch (card.kind) {
        case 'start':
            return { w: START_SIZE, h: START_SIZE };
        case 'delay':
        case 'any':
        case 'all':
            return { w: chipWidth(card), h: CHIP_H };
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
 * How round either end of a card is. A trigger is round where a run begins, a condition and an
 * action are the plain box the rest of the interface draws, a join is round on the side its branches
 * leave by, a wait is round all over and the start card is a circle.
 *
 * It is a language of shapes and not a rule written in them: which side is round says nothing about
 * where a line arrives. What it does is tell the kinds apart on a full worksheet before a word or a
 * color is read, which is what it has to do for anyone who reads color poorly.
 */
export interface CardRounding {
    left: number;
    right: number;
}

/* The radius the rest of the interface gives a box this size. */
const BOX_RADIUS = 10;

/* Round enough to read as an end rather than as a corner, without being a half circle. */
const TRIGGER_RADIUS = 30;
const CHIP_RADIUS = 20;

export const roundingOf = (card: FlowCard): CardRounding => {
    switch (card.kind) {
        case 'trigger':
            return { left: TRIGGER_RADIUS, right: BOX_RADIUS };
        case 'all':
            return { left: BOX_RADIUS, right: CHIP_RADIUS };
        case 'any':
        case 'delay':
            return { left: CHIP_RADIUS, right: CHIP_RADIUS };
        case 'start':
            return { left: START_SIZE / 2, right: START_SIZE / 2 };
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
