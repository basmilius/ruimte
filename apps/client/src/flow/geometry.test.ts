import { describe, expect, test } from 'bun:test';
import type { FlowCard } from '@ruimte/contracts';
import { NODE_GAP } from '@/canvas/edge-route';
import { CARD_H, CARD_W, cardHeight, cardRect, chipWidth, edgeInset, ICON_SIZE, inputDot, portBand, portDot, roundingOf } from '@/flow/geometry';

const card = (over: Partial<FlowCard> = {}): FlowCard => ({ kind: 'condition', args: {}, x: 100, y: 200, ...over });

/* How far a point lies outside the round end this card has on the right, in pixels. */
const outsideRightEnd = (subject: FlowCard, at: { x: number; y: number }): number => {
    const rect = cardRect(subject);
    const radius = roundingOf(subject).right;
    const center = { x: rect.x + rect.w - radius, y: rect.y + rect.h / 2 };
    return Math.hypot(at.x - center.x, at.y - center.y) - radius;
};

describe('where a card really ends', () => {
    test('a straight edge has nothing to give way for', () => {
        expect(edgeInset(CARD_H, 10, 0)).toBe(0);
        expect(edgeInset(CARD_H, 10, CARD_H / 2 - 10)).toBe(0);
    });

    test('a capsule gives way the whole radius at the very corner', () => {
        expect(edgeInset(CARD_H, CARD_H / 2, CARD_H / 2)).toBeCloseTo(CARD_H / 2, 5);
    });

    test('a port beside a round end lands on the curve rather than out in the air beside it', () => {
        // Two ports on a card whose right end is round: the upper one sits where the edge curves away.
        const rect = { x: 0, y: 0, w: 200, h: 80 };
        const band = portBand(rect, 'true', ['true', 'false'], { left: 10, right: 30 });
        expect(band.w).toBeLessThan(rect.w);
        expect(band.w).toBeGreaterThan(rect.w - 30);
    });
});

describe('the ports of a card', () => {
    test('both ports of a condition sit outside the end they leave by', () => {
        const condition = card();
        for (const port of ['true', 'false'] as const) {
            // A line that began inside the card would be drawn over the card it belongs to.
            expect(outsideRightEnd(condition, portDot(condition, port))).toBeGreaterThan(0);
        }
    });

    test('the one port of an action leaves from its plain right edge', () => {
        const action = card({ kind: 'action', card: 'person.notify' });
        const rect = cardRect(action);
        expect(portDot(action, 'done')).toEqual({ x: rect.x + rect.w + NODE_GAP, y: rect.y + rect.h / 2 });
    });

    test('a line lands a gap out from the left, halfway up, where every card is straight', () => {
        const action = card({ kind: 'action', card: 'person.notify' });
        expect(inputDot(action)).toEqual({ x: 100 - NODE_GAP, y: 200 + CARD_H / 2 });
    });

    test('a note is as wide as a card and taller', () => {
        expect(cardRect(card({ kind: 'note' })).w).toBe(CARD_W);
        expect(cardRect(card({ kind: 'note' })).h).toBeGreaterThan(CARD_H);
    });

    test('a card about the graph itself is narrower than one with a sentence on it', () => {
        expect(cardRect(card({ kind: 'delay' })).w).toBeLessThan(CARD_W);
        expect(cardRect(card({ kind: 'start' })).w).toBe(cardRect(card({ kind: 'start' })).h);
    });
});

describe('how tall a card is', () => {
    test('a sentence with two controls in it fits the plain card', () => {
        expect(cardHeight(card({ kind: 'action', card: 'chat.message' }))).toBe(CARD_H);
    });

    test('a third control buys a line rather than a measurement', () => {
        expect(cardHeight(card({ kind: 'condition', card: 'text.contains' }))).toBeGreaterThan(CARD_H);
    });

    test('a field the card is not asking for right now costs nothing', () => {
        // `time.at` carries three fields and never reads more than two of them at once.
        const daily = card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } });
        expect(cardHeight(daily)).toBe(CARD_H);
    });

    test('every height lands on the grid the cards snap to', () => {
        for (const kind of ['trigger', 'condition', 'action'] as const) {
            expect(cardHeight(card({ kind, card: 'text.contains' })) % 8).toBe(0);
        }
    });
});

describe('the shape that tells the kinds apart', () => {
    test('a trigger is round where a run begins and plain where it leaves', () => {
        const rounding = roundingOf(card({ kind: 'trigger', card: 'files.changed' }));
        expect(rounding.left).toBeGreaterThan(rounding.right);
    });

    test('a join is round on the side its branches leave by', () => {
        const rounding = roundingOf(card({ kind: 'all' }));
        expect(rounding.right).toBeGreaterThan(rounding.left);
    });

    test('a condition and an action wear the same box as the rest of the interface', () => {
        expect(roundingOf(card({ kind: 'condition', card: 'text.contains' }))).toEqual(roundingOf(card({ kind: 'action', card: 'person.notify' })));
    });

    test('a start card is a circle', () => {
        const start = card({ kind: 'start' });
        expect(roundingOf(start).left).toBe(cardRect(start).h / 2);
    });
});

describe('how wide a card about the graph itself is', () => {
    test('a join is a chip beside a card and not a block half its width', () => {
        expect(chipWidth(card({ kind: 'any' }))).toBeLessThan(CARD_W / 2);
    });

    test('a chip always has room for the plate and the air around it', () => {
        expect(chipWidth(card({ kind: 'all' }))).toBeGreaterThan(ICON_SIZE);
    });

    test('a wait grows with the number on it rather than being measured', () => {
        const short = card({ kind: 'delay', args: { amount: 5, unit: 'seconds' } });
        const long = card({ kind: 'delay', args: { amount: 1200, unit: 'seconds' } });
        expect(chipWidth(long)).toBeGreaterThan(chipWidth(short));
    });

    test('every chip lands on the grid the cards snap to', () => {
        for (const kind of ['any', 'all', 'delay'] as const) {
            expect(chipWidth(card({ kind })) % 8).toBe(0);
        }
    });
});
