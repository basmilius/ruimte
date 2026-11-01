import { describe, expect, test } from 'bun:test';
import { createVisitor, VISIT_GAP_MS, visitDelay, visitSpot, type VisitClock } from '@extensions/pets/client/canvas/visitor';
import type { CanvasNode } from '@/state/canvas';

/* A clock a test turns by hand: timers wait until `advance` passes their time. */
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

    function nodesOf(...list: Record<string, unknown>[]): Record<string, CanvasNode> {
        return Object.fromEntries(list.map((node) => [node.id, node as unknown as CanvasNode]));
    }

    test('above a node on screen, and never on a group or a node at the edge of the view', () => {
        const nodes = nodesOf(
            { id: 'group', kind: 'group', x: 0, y: 100, w: 600, h: 600 },
            { id: 'edge', kind: 'note', x: 0, y: 10, w: 200, h: 200 },
            { id: 'plan', kind: 'note', x: 100, y: 300, w: 300, h: 200 }
        );
        expect(visitSpot(nodes, new Set(), visible, () => 0)).toEqual({ nodeId: 'plan', x: 124, y: 300 - 62 + 2 });
    });

    test('never where it would stand on another node', () => {
        const nodes = nodesOf({ id: 'upper', kind: 'note', x: 100, y: 0, w: 300, h: 290 }, { id: 'lower', kind: 'note', x: 100, y: 300, w: 300, h: 200 });
        expect(visitSpot(nodes, new Set(), visible, () => 0)).toBeNull();
        expect(visitSpot(nodes, new Set(['upper']), visible, () => 0)?.nodeId).toBe('lower');
    });

    test('nowhere when no node is in view', () => {
        expect(visitSpot(nodesOf({ id: 'far', kind: 'note', x: 4000, y: 4000, w: 200, h: 200 }), new Set(), visible, () => 0)).toBeNull();
    });
});
