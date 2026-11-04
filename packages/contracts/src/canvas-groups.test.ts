import { describe, expect, test } from 'bun:test';
import { emptyCanvasGroupIds, joinGroupUnder } from './canvas-groups.ts';
import type { ProjectCanvasView, ProjectNode } from './project.ts';

const frame: ProjectNode = { id: 'frame', kind: 'group', title: 'Frame', x: 0, y: 0, w: 1000, h: 1000 };
const member: ProjectNode = { id: 'member', kind: 'note', title: 'Member', x: 400, y: 400, w: 100, h: 100 };

function canvas(nodes: ProjectNode[], content: Partial<Pick<ProjectCanvasView, 'texts' | 'lines'>> = {}) {
    return { nodes, texts: [], ...content };
}

describe('empty canvas groups', () => {
    test('deletion removes only affected empty frames, including nested frames that contain each other by their centers', () => {
        const inner = { ...frame, id: 'inner', x: 200, y: 200, w: 600, h: 600 };
        const unrelated = { ...frame, id: 'unrelated', x: 2000 };
        const view = canvas([frame, inner, unrelated, member]);

        expect(emptyCanvasGroupIds(view, new Set(['member']))).toEqual(['frame', 'inner']);
        expect(emptyCanvasGroupIds(view, new Set())).toEqual([]);
    });

    test.each(['text', 'line'] as const)('a frame containing only a %s remains occupied', (kind) => {
        const content: Partial<Pick<ProjectCanvasView, 'texts' | 'lines'>> =
            kind === 'text'
                ? { texts: [{ id: 'text', x: 500, y: 500, text: 'Keep', size: 16 }] }
                : { lines: [{ id: 'line', x: -100, y: 500, endX: 1100, endY: 500, stroke: 'red', strokeWidth: 2, strokeStyle: 'solid' }] };
        const view = canvas([frame, member], content);

        expect(emptyCanvasGroupIds(view, new Set(['member']))).toEqual([]);
        expect(emptyCanvasGroupIds(view, new Set(['member', kind]))).toEqual(['frame']);
    });

    test('collapsed frames use existing remembered members, including ones outside their geometry', () => {
        const collapsed = { ...frame, collapsed: true, h: 40, expandedHeight: 1000, memberIds: ['member', 'missing'] };
        const view = canvas([collapsed, { ...member, x: 2000 }]);

        expect(emptyCanvasGroupIds(view, new Set())).toEqual([]);
        expect(emptyCanvasGroupIds(view, new Set(['member']))).toEqual(['frame']);
    });
});

describe('joining the group under a new node', () => {
    const inner: ProjectNode = { ...frame, id: 'inner', x: 200, y: 200, w: 600, h: 600, memberIds: [] };
    const outer: ProjectNode = { ...frame, memberIds: ['inner'] };

    test('a node joins the smallest frame its center stands in, and only that one', () => {
        const nodes = joinGroupUnder(canvas([outer, inner, member]), 'member');

        expect(nodes.find((node) => node.id === 'inner')?.memberIds).toEqual(['member']);
        expect(nodes.find((node) => node.id === 'frame')?.memberIds).toEqual(['inner']);
    });

    test('a frame that reads its members off positions is left as it is, and so is a frame out of sight', () => {
        const geometric = { ...inner, memberIds: undefined };
        const folded = { ...frame, collapsed: true, memberIds: ['inner'] };

        expect(joinGroupUnder(canvas([geometric, member]), 'member')).toEqual([geometric, member]);
        expect(joinGroupUnder(canvas([folded, inner, member]), 'member')).toEqual([folded, inner, member]);
    });

    test('a group never joins a group it holds', () => {
        const holder = { ...frame, id: 'holder', x: 300, y: 300, w: 400, h: 400, memberIds: [] };
        const big = { ...frame, id: 'big', memberIds: ['holder'] };

        expect(joinGroupUnder(canvas([holder, big]), 'big')).toEqual([holder, big]);
    });
});
