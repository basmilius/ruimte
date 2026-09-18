import { describe, expect, test } from 'bun:test';
import type { ProjectEdge } from '@ruimte/contracts';
import type { EdgeLine } from './edge-lines';
import { edgeLook, lineRole, type EdgeLook } from './edge-look';

const edgeOf = (from: string, to: string, role?: string): ProjectEdge => ({ id: `${from}-${to}`, from, to, ...(role === undefined ? {} : { role }) });

const lineOf = (edge: ProjectEdge, back: ProjectEdge | null = null): EdgeLine => ({
    edge,
    back,
    ids: back === null ? [edge.id] : [edge.id, back.id],
    label: undefined
});

// The only nodes in these tests that a line can read: everything else is a page, a note or a frame.
const reads = (nodeId: string): boolean => nodeId === 'agent' || nodeId === 'other-agent';

const solo = { pair: false, openTask: false };

describe('lineRole', () => {
    test('a line without a role into an agent still reads, which is every project drawn so far', () => {
        expect(lineRole(lineOf(edgeOf('note', 'agent')), reads)).toBe('context');
        expect(lineRole(lineOf(edgeOf('note', 'page')), reads)).toBe('plain');
    });

    test('the role written on the line decides, whichever direction of a pair carries it', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'page', 'target')), reads)).toBe('target');
        expect(lineRole(lineOf(edgeOf('agent', 'other-agent'), edgeOf('other-agent', 'agent', 'origin')), reads)).toBe('origin');
    });

    test('a role a newer Ruimte wrote is no role here, so the line is drawn the way it was', () => {
        expect(lineRole(lineOf(edgeOf('note', 'agent', 'beams')), reads)).toBe('context');
        expect(lineRole(lineOf(edgeOf('note', 'page', 'beams')), reads)).toBe('plain');
    });
});

describe('edgeLook', () => {
    test('a context line one way gives at its tail and is read at its head', () => {
        expect(edgeLook('context', solo)).toEqual({ tail: 'none', head: 'dot', dashed: false, accent: true, width: 2 });
    });

    test('a pair reads both ways, so both ends are closed off the same', () => {
        expect(edgeLook('context', { pair: true, openTask: false })).toEqual({ tail: 'dot', head: 'dot', dashed: false, accent: true, width: 2 });
    });

    test('a task still out dashes the context line it runs along, however the pair stands', () => {
        const open: EdgeLook = { tail: 'none', head: 'dot', dashed: true, accent: true, width: 2 };
        expect(edgeLook('context', { pair: false, openTask: true })).toEqual(open);
        expect(edgeLook('context', { pair: true, openTask: true })).toEqual(open);
        // Settled, the line is a context line again and says so only in its label.
        expect(edgeLook('context', solo).dashed).toBe(false);
    });

    test('a target points into the thing it drives and stays neutral', () => {
        expect(edgeLook('target', solo)).toEqual({ tail: 'none', head: 'chevron', dashed: false, accent: false, width: 2 });
    });

    test('an origin points back at the node that opened the other, thinner than the rest', () => {
        expect(edgeLook('origin', solo)).toEqual({ tail: 'arrow', head: 'dot', dashed: true, accent: false, width: 1 });
        expect(edgeLook('origin', solo).width).toBeLessThan(edgeLook('plain', solo).width);
    });

    test('a plain line carries nothing, so neither end points anywhere', () => {
        expect(edgeLook('plain', solo)).toEqual({ tail: 'dot', head: 'dot', dashed: false, accent: false, width: 2 });
    });
});
