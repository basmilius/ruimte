import { describe, expect, test } from 'bun:test';
import { hintStrength, portHints, takenPorts } from './port-hints';

const node = (id: string, x: number, y: number) => ({ id, x, y, w: 100, h: 100 });
const nodes = [node('a', 0, 0), node('b', 400, 0)];

describe('the ports offered to a pointer', () => {
    test('are the nearest side of every node within reach', () => {
        // Just right of node a, far from node b.
        const hints = portHints(nodes, { x: 120, y: 50 }, 56);
        expect(hints).toHaveLength(1);
        expect(hints[0]!.nodeId).toBe('a');
        expect(hints[0]!.side).toBe('right');
        expect(hints[0]!.at).toEqual({ x: 109, y: 50 });
    });

    test('are one per node, so walking past a node lights one dot at a time', () => {
        expect(portHints(nodes, { x: 60, y: 130 }, 56).map((hint) => hint.side)).toEqual(['bottom']);
        // Right between two sides the nearer one wins, never both.
        expect(portHints(nodes, { x: 100, y: 100 }, 56)).toHaveLength(1);
    });

    test('stop at the reach and fade in over the half of it', () => {
        expect(portHints(nodes, { x: 200, y: 50 }, 56)).toEqual([]);
        expect(portHints(nodes, { x: 151, y: 50 }, 56)[0]!.strength).toBeCloseTo(0.5);
        expect(portHints(nodes, { x: 115, y: 50 }, 56)[0]!.strength).toBe(1);
    });

    test('include a side a line already leaves from, which is the only way to start a second one there', () => {
        const hints = portHints(nodes, { x: 120, y: 50 }, 56);
        expect(hints.map((hint) => hint.side)).toEqual(['right']);
        expect(takenPorts([{ from: 'a', to: 'b' }], (id) => nodes.find((candidate) => candidate.id === id) ?? null)).toContain('a:right');
    });
});

describe('the sides a line already uses', () => {
    const rectOf = (id: string) => nodes.find((candidate) => candidate.id === id) ?? null;

    test('are the facing sides of the nodes it runs between', () => {
        expect([...takenPorts([{ from: 'a', to: 'b' }], rectOf)]).toEqual(['a:right', 'b:left']);
    });

    test('are the right side alone for a line onto its own node', () => {
        expect([...takenPorts([{ from: 'a', to: 'a' }], rectOf)]).toEqual(['a:right']);
    });

    test('are none for an edge whose node is gone or hidden', () => {
        expect([...takenPorts([{ from: 'a', to: 'gone' }], rectOf)]).toEqual([]);
    });
});

describe('how far a port has come for the pointer', () => {
    test('is nothing at the reach and all the way in over the half of it', () => {
        expect(hintStrength(56, 56)).toBe(0);
        expect(hintStrength(42, 56)).toBeCloseTo(0.5);
        expect(hintStrength(28, 56)).toBe(1);
        expect(hintStrength(0, 56)).toBe(1);
    });

    test('stays in range for a pointer nowhere near, which is what a worksheet asks it', () => {
        expect(hintStrength(400, 56)).toBe(0);
        expect(hintStrength(Infinity, 56)).toBe(0);
    });
});
