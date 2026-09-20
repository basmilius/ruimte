import { describe, expect, test } from 'bun:test';
import type { FlowCard } from '@ruimte/contracts';
import { NODE_GAP } from '@/canvas/edge-route';
import { CARD_H, CARD_W, cardRect, edgeInset, inputDot, portDot, roundingOf } from '@/flow/geometry';

const card = (over: Partial<FlowCard> = {}): FlowCard => ({ kind: 'condition', args: {}, x: 100, y: 200, ...over });

/* How far a point lies outside the capsule that ends this card on the right, in pixels. */
const outsideRightCapsule = (subject: FlowCard, at: { x: number; y: number }): number => {
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
});

describe('the ports of a card', () => {
    test('both ports of a condition sit outside the capsule they leave by', () => {
        const condition = card();
        for (const port of ['true', 'false'] as const) {
            // A line that began inside the card would be drawn over the card it belongs to.
            expect(outsideRightCapsule(condition, portDot(condition, port))).toBeGreaterThan(0);
        }
    });

    test('a port beside a capsule is pulled in to the curve instead of hanging beside it', () => {
        const condition = card();
        const rect = cardRect(condition);
        expect(portDot(condition, 'true').x).toBeLessThan(rect.x + rect.w + NODE_GAP);
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
