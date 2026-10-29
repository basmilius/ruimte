import { describe, expect, test } from 'bun:test';
import { edgeLines } from '@/canvas/edge-lines';
import { nextVisit, tripPagesOf, TRIP_MIN_STAY_MS, TRIP_QUIET_MS } from '@/canvas/pets/page-trip';
import type { CanvasNode, Edge } from '@/state/canvas';

function node(id: string, kind: CanvasNode['kind']): CanvasNode {
    return { id, kind, x: 0, y: 0, w: 400, h: 300 } as CanvasNode;
}

const NODES: Record<string, CanvasNode> = {
    claude: node('claude', 'chat'),
    shop: node('shop', 'browser'),
    docs: node('docs', 'browser'),
    notes: node('notes', 'note'),
    phone: node('phone', 'device')
};

describe('the pages a pet walks to', () => {
    test('are the pages at the other end of a target line from its agent, drawn either way', () => {
        const lines = edgeLines([
            { id: 'e1', from: 'claude', to: 'shop' },
            { id: 'e2', from: 'docs', to: 'claude' }
        ] as Edge[]);
        expect(tripPagesOf('claude', lines, NODES, new Set())).toEqual(['shop', 'docs']);
    });

    test('take a device the agent operates too, and leave out a note, another agent and a page a collapsed group hides', () => {
        const lines = edgeLines([
            { id: 'e1', from: 'claude', to: 'notes' },
            { id: 'e2', from: 'claude', to: 'phone' },
            { id: 'e3', from: 'claude', to: 'shop' }
        ] as Edge[]);
        expect(tripPagesOf('claude', lines, NODES, new Set(['shop']))).toEqual(['phone']);
        expect(tripPagesOf('other', lines, NODES, new Set())).toEqual([]);
    });
});

describe('where a pet goes', () => {
    const at = 100_000;

    test('to a page at its first ask, and home after a quiet spell', () => {
        const going = nextVisit(null, new Map([['shop', at]]), at, false);
        expect(going).toEqual({ pageId: 'shop', since: at });
        expect(nextVisit(going, new Map([['shop', at]]), at + TRIP_QUIET_MS - 1, false)).toBe(going);
        expect(nextVisit(going, new Map([['shop', at]]), at + TRIP_QUIET_MS, false)).toBeNull();
    });

    test('stays a while before it moves on to another page, so it does not run back and forth', () => {
        const visit = { pageId: 'shop', since: at };
        const asks = new Map([
            ['shop', at],
            ['docs', at + 1_000]
        ]);
        expect(nextVisit(visit, asks, at + 1_000, false)).toBe(visit);
        expect(nextVisit(visit, asks, at + TRIP_MIN_STAY_MS, false)).toEqual({ pageId: 'docs', since: at + TRIP_MIN_STAY_MS });
    });

    test('stays home while nothing was asked lately, and goes home at once when it waits on you', () => {
        expect(nextVisit(null, new Map([['shop', at - TRIP_QUIET_MS]]), at, false)).toBeNull();
        expect(nextVisit({ pageId: 'shop', since: at }, new Map([['shop', at]]), at, true)).toBeNull();
    });
});
