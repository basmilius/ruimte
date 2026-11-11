import { describe, expect, test } from 'bun:test';
import type { PetNode } from './placement';
import { createVisitor, VISIT_GAP_MS, visitDelay, visitSpot, type VisitClock } from './visitor';

function fakeClock(random: () => number = () => 0.5) {
    let now = 0;
    let next = 1;
    const timers = new Map<number, { at: number; run: () => void }>();
    const clock: VisitClock = {
        setTimeout(run, ms) {
            const id = next++;
            timers.set(id, { at: now + ms, run });
            return id;
        },
        clearTimeout(handle) {
            timers.delete(handle as number);
        },
        random
    };
    const advance = (ms: number): void => {
        const until = now + ms;
        for (;;) {
            const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (due === undefined) {
                break;
            }
            timers.delete(due[0]);
            now = due[1].at;
            due[1].run();
        }
        now = until;
    };
    return { clock, advance, pending: () => timers.size };
}

describe('when a visitor comes', () => {
    test('somewhere between twenty minutes and an hour', () => {
        expect(visitDelay(() => 0)).toBe(VISIT_GAP_MS.min);
        expect(visitDelay(() => 0.999_999)).toBeLessThanOrEqual(VISIT_GAP_MS.max);
        expect(visitDelay(() => 0.5)).toBe((VISIT_GAP_MS.min + VISIT_GAP_MS.max) / 2);
    });

    test('never before the gap, once at it, and again only after another gap', () => {
        const { clock, advance } = fakeClock(() => 0);
        const visitor = createVisitor(clock);
        let visits = 0;
        visitor.host(() => {
            visits += 1;
            return true;
        });
        advance(VISIT_GAP_MS.min - 1);
        expect(visits).toBe(0);
        advance(1);
        expect(visits).toBe(1);
        advance(VISIT_GAP_MS.min - 1);
        expect(visits).toBe(1);
        advance(1);
        expect(visits).toBe(2);
    });

    test('to the canvas that came last, or the one before it when that one passes', () => {
        const { clock, advance } = fakeClock(() => 0);
        const visitor = createVisitor(clock);
        const seen: string[] = [];
        visitor.host(() => {
            seen.push('first');
            return true;
        });
        visitor.host(() => {
            seen.push('second');
            return false;
        });
        advance(VISIT_GAP_MS.min);
        expect(seen).toEqual(['second', 'first']);
    });

    test('one clock for two canvases, and none once the last one goes', () => {
        const { clock, advance, pending } = fakeClock();
        const visitor = createVisitor(clock);
        const stopFirst = visitor.host(() => true);
        const stopSecond = visitor.host(() => true);
        expect(pending()).toBe(1);
        stopFirst();
        expect(visitor.scheduled()).toBe(true);
        stopSecond();
        expect(visitor.scheduled()).toBe(false);
        expect(pending()).toBe(0);
        advance(VISIT_GAP_MS.max);
        expect(pending()).toBe(0);
    });
});

describe('where a visitor stands', () => {
    const visible = { x: 0, y: 0, w: 1000, h: 800 };

    function node(id: string, kind: string, x: number, y: number, w: number, h: number, hidden = false): PetNode {
        return { id, kind, title: id, x, y, w, h, hidden, groupId: null };
    }

    test('above a node on screen, and never on a group or a node at the edge of the view', () => {
        const nodes = [node('group', 'group', 0, 100, 600, 600), node('edge', 'note', 0, 10, 200, 200), node('plan', 'note', 100, 300, 300, 200)];
        expect(visitSpot(nodes, visible, () => 0)).toEqual({ nodeId: 'plan', x: 124, y: 300 - 62 + 2 });
    });

    test('never where it would stand on another node', () => {
        const lower = node('lower', 'note', 100, 300, 300, 200);
        expect(visitSpot([node('upper', 'note', 100, 0, 300, 290), lower], visible, () => 0)).toBeNull();
        expect(visitSpot([node('upper', 'note', 100, 0, 300, 290, true), lower], visible, () => 0)?.nodeId).toBe('lower');
    });

    test('nowhere when no node is in view', () => {
        expect(visitSpot([node('far', 'note', 4000, 4000, 200, 200)], visible, () => 0)).toBeNull();
    });
});
