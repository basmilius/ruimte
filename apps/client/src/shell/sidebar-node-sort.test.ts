import { describe, expect, test } from 'bun:test';
import { nodeSortFrom, nodeSortThenFrom, sortHasGroups, sortNodes } from './sidebar-node-sort';
import type { SidebarNode } from './sidebar-rows';

function node(title: string, extra: Partial<SidebarNode> = {}): SidebarNode {
    return { id: title, title, kind: 'terminal', provider: null, status: null, draft: false, ...extra };
}

const titles = (nodes: readonly SidebarNode[]) => nodes.map((one) => one.title);

describe('sortNodes', () => {
    const nodes = [
        node('PBL-156 infra', { kind: 'chat', provider: 'claude', status: 'running', work: 'turn' }),
        node('notes', { kind: 'browser' }),
        node('PBL-9 cosign', { kind: 'chat', provider: 'claude', status: 'idle', work: null, finished: true }),
        node('bun dev', { status: 'running', work: null }),
        node('ai-timo', { kind: 'chat', provider: 'codex', status: 'idle', work: null }),
        node('jeroen-ai', { kind: 'chat', provider: 'claude', status: 'needs-you', work: null })
    ];

    test('in canvas order the list is the canvas, the same array', () => {
        expect(sortNodes(nodes, 'canvas', 'newest')).toBe(nodes);
    });

    test('by name A to Z, numbers as a person reads them', () => {
        expect(titles(sortNodes(nodes, 'name', 'newest'))).toEqual(['ai-timo', 'bun dev', 'jeroen-ai', 'notes', 'PBL-9 cosign', 'PBL-156 infra']);
    });

    test('by status: waits on you, at work, done unseen, then the rest, the newest first within each', () => {
        expect(titles(sortNodes(nodes, 'status', 'newest'))).toEqual(['jeroen-ai', 'PBL-156 infra', 'PBL-9 cosign', 'ai-timo', 'bun dev', 'notes']);
    });

    test('within a group the oldest first or by name when a person picks it', () => {
        const rest = [node('zeta'), node('alpha'), node('mid')];
        expect(titles(sortNodes(rest, 'status', 'oldest'))).toEqual(['zeta', 'alpha', 'mid']);
        expect(titles(sortNodes(rest, 'status', 'newest'))).toEqual(['mid', 'alpha', 'zeta']);
        expect(titles(sortNodes(rest, 'status', 'name'))).toEqual(['alpha', 'mid', 'zeta']);
    });

    test('a stopped or failed node comes after a finished one and before the quiet rest', () => {
        const mixed = [node('quiet'), node('failed', { status: 'error' }), node('done', { finished: true }), node('gone', { status: 'exited' })];
        expect(titles(sortNodes(mixed, 'status', 'oldest'))).toEqual(['done', 'failed', 'gone', 'quiet']);
    });

    test("another project's running node counts as at work, since it cannot tell", () => {
        const remote = [node('idle', { status: 'idle' }), node('busy', { status: 'running' })];
        expect(titles(sortNodes(remote, 'status', 'oldest'))).toEqual(['busy', 'idle']);
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
        expect(titles(sortNodes(kinds, 'kind', 'oldest'))).toEqual(['agent', 'chat', 'shell', 'page', 'design', 'phone']);
    });
});

describe('stored choices', () => {
    test('anything else reads as the canvas order and the newest first', () => {
        expect(nodeSortFrom('status')).toBe('status');
        expect(nodeSortFrom('random')).toBe('canvas');
        expect(nodeSortFrom(undefined)).toBe('canvas');
        expect(nodeSortThenFrom('name')).toBe('name');
        expect(nodeSortThenFrom(3)).toBe('newest');
    });

    test('only kind and status have groups to order within', () => {
        expect(['canvas', 'name', 'kind', 'status'].filter((sort) => sortHasGroups(nodeSortFrom(sort)))).toEqual(['kind', 'status']);
    });
});
