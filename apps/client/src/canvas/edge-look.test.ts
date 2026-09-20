import { describe, expect, test } from 'bun:test';
import type { ProjectEdge } from '@ruimte/contracts';
import type { EdgeLine } from './edge-lines';
import { edgeLook, edgeStroke, flowLook, lineRole, type EdgeLook } from './edge-look';

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

describe('lineRole', () => {
    test('a line without a role into an agent still reads, which is every project drawn so far', () => {
        expect(lineRole(lineOf(edgeOf('note', 'agent')), reads, driven)).toBe('context');
        expect(lineRole(lineOf(edgeOf('note', 'page')), reads, driven)).toBe('plain');
    });

    test('a line out of an agent into something that never reads is the same context line', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'note')), reads, driven)).toBe('context');
    });

    test('a line out of an agent into a device or a page says the agent works there', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'phone')), reads, driven)).toBe('target');
        expect(lineRole(lineOf(edgeOf('agent', 'page')), reads, driven)).toBe('target');
    });

    test('the same line drawn the other way is what the agent reads, so it stays a context line', () => {
        expect(lineRole(lineOf(edgeOf('phone', 'agent')), reads, driven)).toBe('context');
        expect(lineRole(lineOf(edgeOf('page', 'agent')), reads, driven)).toBe('context');
    });

    test('a pair between an agent and a device says the reading out loud, so it is drawn as one', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'phone'), edgeOf('phone', 'agent')), reads, driven)).toBe('context');
    });

    test('between two agents a line keeps reading into its head, whatever lies at the tail', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'other-agent')), reads, driven)).toBe('context');
    });

    test('the role written on the line decides, whichever direction of a pair carries it', () => {
        expect(lineRole(lineOf(edgeOf('agent', 'page', 'target')), reads, driven)).toBe('target');
        expect(lineRole(lineOf(edgeOf('phone', 'agent', 'target')), reads, driven)).toBe('target');
        expect(lineRole(lineOf(edgeOf('agent', 'other-agent'), edgeOf('other-agent', 'agent', 'origin')), reads, driven)).toBe('origin');
    });

    test('a role a newer Ruimte wrote is no role here, so the line is drawn the way it was', () => {
        expect(lineRole(lineOf(edgeOf('note', 'agent', 'beams')), reads, driven)).toBe('context');
        expect(lineRole(lineOf(edgeOf('note', 'page', 'beams')), reads, driven)).toBe('plain');
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

    test('an origin points at what was opened, thinner than the rest', () => {
        expect(edgeLook('origin', solo)).toEqual({ tail: 'dot', head: 'arrow', dashed: true, accent: false, width: 1 });
        expect(edgeLook('origin', solo).width).toBeLessThan(edgeLook('plain', solo).width);
    });

    test('a plain line carries nothing, so neither end points anywhere', () => {
        expect(edgeLook('plain', solo)).toEqual({ tail: 'dot', head: 'dot', dashed: false, accent: false, width: 2 });
    });
});

describe('flowLook', () => {
    test('the way a run carries on is drawn through and carries something', () => {
        expect(flowLook('done')).toEqual({ tail: 'dot', head: 'chevron', dashed: false, accent: true, width: 2 });
        expect(flowLook('true')).toEqual(flowLook('done'));
    });

    test('the way out of a false answer or of something gone wrong is dashed and neutral', () => {
        expect(flowLook('false')).toEqual({ tail: 'dot', head: 'chevron', dashed: true, accent: false, width: 2 });
        expect(flowLook('error')).toEqual(flowLook('false'));
    });

    test('every line out of a card points into the card that runs next', () => {
        for (const port of ['done', 'error', 'true', 'false'] as const) {
            expect(flowLook(port).head).toBe('chevron');
            expect(flowLook(port).tail).toBe('dot');
        }
    });
});

describe('edgeStroke', () => {
    test('a line that carries something runs in the context color, and in the accent once it is active', () => {
        expect(edgeStroke(edgeLook('context', solo), false)).toBe('var(--edge-context)');
        expect(edgeStroke(edgeLook('context', solo), true)).toBe('var(--accent)');
    });

    test('every other line runs in the neutral, and lifts to the muted text once it is active', () => {
        expect(edgeStroke(edgeLook('plain', solo), false)).toBe('var(--edge-line)');
        expect(edgeStroke(edgeLook('plain', solo), true)).toBe('var(--text-muted)');
    });

    test('a worksheet reads from the same two pairs, so one line is one color wherever it is drawn', () => {
        expect(edgeStroke(flowLook('true'), false)).toBe(edgeStroke(edgeLook('context', solo), false));
        expect(edgeStroke(flowLook('false'), true)).toBe(edgeStroke(edgeLook('plain', solo), true));
    });
});
