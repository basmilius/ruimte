import { describe, expect, test } from 'bun:test';
import type { ProjectEdge } from '@ruimte/contracts';
import type { EdgeLine } from './edge-lines';
import { edgeLook, lineMeaning, type EdgeLook } from './edge-look';

const edgeOf = (from: string, to: string, role?: string): ProjectEdge => ({ id: `${from}-${to}`, from, to, ...(role === undefined ? {} : { role }) });

const lineOf = (edge: ProjectEdge, back: ProjectEdge | null = null): EdgeLine => ({
    edge,
    back,
    ids: back === null ? [edge.id] : [edge.id, back.id],
    label: undefined
});

// The only nodes in these tests that a line can read: everything else is a page, a note or a device.
const reads = (nodeId: string): boolean => nodeId === 'agent' || nodeId === 'other-agent';

// The nodes an agent works on rather than reads.
const driven = (nodeId: string): boolean => nodeId === 'page' || nodeId === 'phone';

const solo = { pair: false, openTask: false };

const roleOf = (line: EdgeLine): string => lineMeaning(line, reads, driven).role;

const look = (role: 'context' | 'target' | 'origin' | 'plain', options = solo): EdgeLook => edgeLook({ role, reversed: false }, options);

describe('lineMeaning', () => {
    test('a line without a role into an agent still reads, which is every project drawn so far', () => {
        expect(roleOf(lineOf(edgeOf('note', 'agent')))).toBe('context');
        expect(roleOf(lineOf(edgeOf('note', 'page')))).toBe('plain');
    });

    test('a line out of an agent into something that never reads is the same context line', () => {
        expect(roleOf(lineOf(edgeOf('agent', 'note')))).toBe('context');
    });

    test('a line between an agent and a device or a page says the agent works there, drawn either way', () => {
        expect(roleOf(lineOf(edgeOf('agent', 'phone')))).toBe('target');
        expect(roleOf(lineOf(edgeOf('page', 'agent')))).toBe('target');
        expect(roleOf(lineOf(edgeOf('agent', 'phone'), edgeOf('phone', 'agent')))).toBe('target');
    });

    test('the head of a target line sits at the node being worked on, however the line was drawn', () => {
        expect(lineMeaning(lineOf(edgeOf('agent', 'page')), reads, driven).reversed).toBe(false);
        expect(lineMeaning(lineOf(edgeOf('page', 'agent')), reads, driven).reversed).toBe(true);
        expect(edgeLook(lineMeaning(lineOf(edgeOf('page', 'agent')), reads, driven), solo)).toEqual({
            tail: 'chevron',
            head: 'none',
            dashed: false,
            accent: false,
            width: 2
        });
    });

    test('between two agents a line keeps reading into its head, whatever lies at the tail', () => {
        expect(roleOf(lineOf(edgeOf('agent', 'other-agent')))).toBe('context');
    });

    test('the role written on the line decides, whichever direction of a pair carries it', () => {
        expect(roleOf(lineOf(edgeOf('agent', 'page', 'target')))).toBe('target');
        expect(roleOf(lineOf(edgeOf('phone', 'agent', 'target')))).toBe('target');
        expect(roleOf(lineOf(edgeOf('agent', 'other-agent'), edgeOf('other-agent', 'agent', 'origin')))).toBe('origin');
    });

    test('a role a newer Ruimte wrote is no role here, so the line is drawn the way it was', () => {
        expect(roleOf(lineOf(edgeOf('note', 'agent', 'beams')))).toBe('context');
        expect(roleOf(lineOf(edgeOf('note', 'page', 'beams')))).toBe('plain');
    });
});

describe('edgeLook', () => {
    test('a context line one way gives at its tail and is read at its head', () => {
        expect(look('context')).toEqual({ tail: 'none', head: 'dot', dashed: false, accent: true, width: 2 });
    });

    test('a pair reads both ways, so both ends are closed off the same', () => {
        expect(look('context', { pair: true, openTask: false })).toEqual({ tail: 'dot', head: 'dot', dashed: false, accent: true, width: 2 });
    });

    test('a task still out dashes the context line it runs along, however the pair stands', () => {
        const open: EdgeLook = { tail: 'none', head: 'dot', dashed: true, accent: true, width: 2 };
        expect(look('context', { pair: false, openTask: true })).toEqual(open);
        expect(look('context', { pair: true, openTask: true })).toEqual(open);
        // Settled, the line is a context line again and says so only in its label.
        expect(look('context').dashed).toBe(false);
    });

    test('a target points into the thing it drives and stays neutral', () => {
        expect(look('target')).toEqual({ tail: 'none', head: 'chevron', dashed: false, accent: false, width: 2 });
    });

    test('an origin points at what was opened, thinner than the rest', () => {
        expect(look('origin')).toEqual({ tail: 'dot', head: 'arrow', dashed: true, accent: false, width: 1 });
        expect(look('origin').width).toBeLessThan(look('plain').width);
    });

    test('a plain line carries nothing, so neither end points anywhere', () => {
        expect(look('plain')).toEqual({ tail: 'dot', head: 'dot', dashed: false, accent: false, width: 2 });
    });
});
