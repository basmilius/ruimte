import { describe, expect, test } from 'bun:test';
import { nodeSortFrom, nodeSortThenFrom, sortHasGroups, sortNodes } from './sidebar-node-sort';
import type { SidebarNode } from './sidebar-rows';

function node(title: string, extra: Partial<SidebarNode> = {}): SidebarNode {
    return { id: title, title, kind: 'terminal', provider: null, status: null, draft: false, ...extra };
}

const titles = (nodes: readonly SidebarNode[]) => nodes.map((one) => one.title);

describe('sortNodes', () => {
    const nodes = [
        node('PBL-156 infra', { kind: 'chat', provider: 'claude', status: 'running', work: 'turn', activity: 50 }),
        node('notes', { kind: 'browser', activity: 10 }),
        node('PBL-9 cosign', { kind: 'chat', provider: 'claude', status: 'idle', work: null, finished: true, activity: 40 }),
        node('bun dev', { status: 'running', work: null, activity: 20 }),
        node('ai-timo', { kind: 'chat', provider: 'codex', status: 'error', work: null, activity: 30 }),
        node('jeroen-ai', { kind: 'chat', provider: 'claude', status: 'needs-you', work: null, activity: 60 })
    ];

    test('in canvas order the list is the canvas, the same array', () => {
        expect(sortNodes(nodes, 'canvas', 'recent')).toBe(nodes);
    });

    test('recently updated first, a node the machine knows nothing of last in canvas order', () => {
        const unknown = [node('second'), node('old', { activity: 1 }), node('first'), node('new', { activity: 2 })];

        expect(titles(sortNodes(unknown, 'recent', 'name'))).toEqual(['new', 'old', 'second', 'first']);
    });

    test('by name A to Z, numbers as a person reads them', () => {
        expect(titles(sortNodes(nodes, 'name', 'recent'))).toEqual(['ai-timo', 'bun dev', 'jeroen-ai', 'notes', 'PBL-9 cosign', 'PBL-156 infra']);
    });

    test('by status: waits on you, stopped, at work, done unseen, then the rest, the most recent first within each', () => {
        expect(titles(sortNodes(nodes, 'status', 'recent'))).toEqual(['jeroen-ai', 'ai-timo', 'PBL-156 infra', 'PBL-9 cosign', 'bun dev', 'notes']);
    });

    test('a snoozed wait counts as the rest until it runs out', () => {
        const waits = [node('quiet', { activity: 1 }), node('snoozed', { status: 'needs-you', snoozedUntil: 5_000, activity: 2 })];

        expect(titles(sortNodes(waits, 'status', 'recent'))).toEqual(['snoozed', 'quiet']);
        expect(titles(sortNodes(waits, 'status', 'least-recent'))).toEqual(['quiet', 'snoozed']);
    });

    test('within a group the least recent first or by name when a person picks it', () => {
        const rest = [node('zeta', { activity: 2 }), node('alpha', { activity: 3 }), node('mid', { activity: 1 })];

        expect(titles(sortNodes(rest, 'status', 'recent'))).toEqual(['alpha', 'zeta', 'mid']);
        expect(titles(sortNodes(rest, 'status', 'least-recent'))).toEqual(['mid', 'zeta', 'alpha']);
        expect(titles(sortNodes(rest, 'status', 'name'))).toEqual(['alpha', 'mid', 'zeta']);
    });

    test("another project's running node counts as at work, since it cannot tell", () => {
        const remote = [node('idle', { status: 'idle' }), node('busy', { status: 'running' })];

        expect(titles(sortNodes(remote, 'status', 'recent'))).toEqual(['busy', 'idle']);
    });

    test('by kind: sessions and agents in a terminal, terminals, browsers, designs, devices', () => {
        const kinds = [
            node('phone', { kind: 'device' }),
            node('page', { kind: 'browser' }),
            node('shell'),
            node('design', { kind: 'design' }),
            node('agent', { provider: 'claude' }),
            node('chat', { kind: 'chat', provider: 'codex' })
        ];

        expect(titles(sortNodes(kinds, 'kind', 'name'))).toEqual(['agent', 'chat', 'shell', 'page', 'design', 'phone']);
    });

    test('held positions keep every row where it stood, and a node added since goes last', () => {
        const held = new Map([
            ['notes', 0],
            ['bun dev', 1]
        ]);
        const later = [node('bun dev', { activity: 9 }), node('added'), node('notes', { activity: 1 })];

        expect(titles(sortNodes(later, 'recent', 'recent', held))).toEqual(['notes', 'bun dev', 'added']);
    });
});

describe('stored choices', () => {
    test('anything else reads as the canvas order and the most recent first', () => {
        expect(nodeSortFrom('recent')).toBe('recent');
        expect(nodeSortFrom('random')).toBe('canvas');
        expect(nodeSortFrom(undefined)).toBe('canvas');
        expect(nodeSortThenFrom('least-recent')).toBe('least-recent');
        expect(nodeSortThenFrom('newest')).toBe('recent');
    });

    test('only kind and status have groups to order within', () => {
        expect(['canvas', 'recent', 'name', 'kind', 'status'].filter((sort) => sortHasGroups(nodeSortFrom(sort)))).toEqual(['kind', 'status']);
    });
});
