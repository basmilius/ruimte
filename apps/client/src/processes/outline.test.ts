import { describe, expect, test } from 'bun:test';
import type { ProcessGroup, ProjectSidebarView, ProjectSummary } from '@ruimte/contracts';
import { barOf } from './bars.ts';
import { processOutline } from './outline.ts';

function group(id: string, kind: ProcessGroup['kind'], nodeId: string | null, extra: Partial<ProcessGroup> = {}): ProcessGroup {
    return { id, kind, nodeId, cpu: 10, memory: 100, diskRead: 1, diskWrite: 1, processes: [], hidden: 0, ...extra };
}

function summary(projectId: string): ProjectSummary {
    return {
        projectId,
        name: projectId,
        color: '#123456',
        folder: `/work/${projectId}`,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: 'P' },
        nameSource: 'chosen'
    };
}

function canvas(id: string, nodeIds: string[]): ProjectSidebarView {
    return {
        id,
        name: id,
        kind: 'canvas',
        icon: null,
        provider: null,
        path: null,
        shared: false,
        nodes: nodeIds.map((nodeId) => ({ id: nodeId, title: nodeId, kind: 'chat', provider: null })),
        self: null
    };
}

describe('processOutline', () => {
    test('lists the projects in the order given, their views and nodes in sidebar order, then Ruimte itself', () => {
        const groups = [
            group('daemon', 'daemon', null),
            group('app', 'app', null),
            group('chat:b2', 'chat', 'b2', { projectId: 'b' }),
            group('chat:a2', 'chat', 'a2', { projectId: 'a' }),
            group('chat:a1', 'chat', 'a1', { projectId: 'a' })
        ];
        const outline = processOutline(
            groups,
            [
                { summary: summary('b'), views: [canvas('work', ['b1', 'b2'])] },
                { summary: summary('a'), views: [canvas('first', ['a1']), canvas('empty', ['a3']), canvas('second', ['a2'])] }
            ],
            new Map([['a1', 'Renamed']])
        );

        expect(outline.map((project) => project.projectId)).toEqual(['b', 'a', null]);
        expect(outline[1]!.items.map((item) => item.id)).toEqual(['first', 'second']);
        expect(outline[1]!.items[0]!.kind === 'view' && outline[1]!.items[0]!.nodes[0]!.title).toBe('Renamed');
        expect(outline[2]!.items.map((item) => item.id)).toEqual(['app', 'daemon']);
    });

    test('puts a group no listed node stands for under its project, and one no project places under Ruimte itself', () => {
        const outline = processOutline(
            [group('terminal:launch', 'terminal', 'launch', { projectId: 'a', label: 'dev' }), group('chat:lost', 'chat', 'lost')],
            [{ summary: summary('a'), views: null }],
            new Map()
        );

        expect(outline.map((project) => project.items.map((item) => item.id))).toEqual([['terminal:launch'], ['chat:lost']]);
    });

    test('sums a project over its nodes, a value nobody could read staying null', () => {
        const outline = processOutline(
            [group('chat:a1', 'chat', 'a1', { projectId: 'a' }), group('chat:a2', 'chat', 'a2', { projectId: 'a', cpu: null })],
            [{ summary: summary('a'), views: [canvas('work', ['a1', 'a2'])] }],
            new Map()
        );

        expect(outline[0]!.totals).toEqual({ cpu: 10, memory: 200, disk: 4 });
    });
});

describe('barOf', () => {
    test('gives each part its share of the whole and the rest of the machine what is left of what it uses', () => {
        const bar = barOf(
            [
                { key: 'a', color: '#123456', value: 10 },
                { key: 'ruimte', color: null, value: 5 }
            ],
            40,
            100
        );

        expect(bar.parts.map((part) => part.percent)).toEqual([10, 5]);
        expect(bar.rest).toBe(25);
    });

    test('never draws past the whole', () => {
        const bar = barOf([{ key: 'a', color: null, value: 150 }], 120, 100);

        expect(bar.parts[0]!.percent).toBe(100);
        expect(bar.rest).toBe(0);
    });
});
