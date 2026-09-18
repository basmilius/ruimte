import { describe, expect, test } from 'bun:test';
import type { Edge } from '@/state/canvas';
import { canLink, edgeLines, selectedLine, textRect } from './edge-lines';

const edge = (id: string, from: string, to: string, label?: string): Edge => ({ id, from, to, ...(label === undefined ? {} : { label }) });

describe('edgeLines', () => {
    test('two edges between the same nodes are one line with both of their ids', () => {
        const lines = edgeLines([edge('e1', 'a', 'b'), edge('e2', 'b', 'a')]);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.edge.id).toBe('e1');
        expect(lines[0]!.back?.id).toBe('e2');
        expect(lines[0]!.ids).toEqual(['e1', 'e2']);
    });

    test('one direction stays one line with one id', () => {
        const lines = edgeLines([edge('e1', 'a', 'b')]);
        expect(lines[0]!.back).toBeNull();
        expect(lines[0]!.ids).toEqual(['e1']);
    });

    test('keeps the order of the edges and leaves the unpaired ones alone', () => {
        const lines = edgeLines([edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'b', 'a'), edge('e4', 'c', 'd')]);
        expect(lines.map((line) => line.ids)).toEqual([['e1', 'e3'], ['e2'], ['e4']]);
    });

    test('a name on either direction names the line, and the first one wins', () => {
        expect(edgeLines([edge('e1', 'a', 'b'), edge('e2', 'b', 'a', 'context')])[0]!.label).toBe('context');
        expect(edgeLines([edge('e1', 'a', 'b', 'reads'), edge('e2', 'b', 'a', 'context')])[0]!.label).toBe('reads');
    });

    test('a line onto itself is never folded into another one', () => {
        const lines = edgeLines([edge('e1', 'a', 'a'), edge('e2', 'a', 'a')]);
        expect(lines.map((line) => line.ids)).toEqual([['e1'], ['e2']]);
    });
});

describe('selectedLine', () => {
    const lines = edgeLines([edge('e1', 'a', 'b'), edge('e2', 'b', 'a'), edge('e3', 'b', 'c')]);

    test('is the line the whole selection stands for, and nothing else', () => {
        expect(selectedLine(lines, ['e1', 'e2'])?.edge.id).toBe('e1');
        expect(selectedLine(lines, ['e2', 'e1'])?.edge.id).toBe('e1');
        expect(selectedLine(lines, ['e3'])?.edge.id).toBe('e3');
        // Half a pair, or a pair plus a node, is not one line.
        expect(selectedLine(lines, ['e1'])).toBeNull();
        expect(selectedLine(lines, ['e1', 'e2', 'node-1'])).toBeNull();
        expect(selectedLine(lines, [])).toBeNull();
    });
});

describe('what an edge aims at', () => {
    test('a text is aimed at by the box its words take up', () => {
        expect(textRect({ x: 10, y: 20, size: 16, text: 'hello' })).toEqual({ x: 10, y: 20, w: 44, h: 22.4 });
        // Never narrower than something you can aim at.
        expect(textRect({ x: 0, y: 0, size: 16, text: '' }).w).toBe(40);
    });
});

describe('whether a line may be drawn', () => {
    const edges = [edge('e1', 'a', 'b')];

    test('is no for a node onto itself and for a pair that already has one', () => {
        expect(canLink(edges, 'a', 'c')).toBe(true);
        expect(canLink(edges, 'a', 'a')).toBe(false);
        expect(canLink(edges, 'a', 'b')).toBe(false);
        // Whichever way the first one was drawn.
        expect(canLink(edges, 'b', 'a')).toBe(false);
    });
});
