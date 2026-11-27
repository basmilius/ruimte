import { describe, expect, test } from 'bun:test';
import { emptyCanvasGroupIds, groupsGrownAround, joinGroup, joinGroupUnder } from './canvas-groups.ts';
import { GROUP_HEADER, GROUP_PADDING } from './node-defaults.ts';
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
    const inner: ProjectNode = { ...frame, id: 'inner', x: 200, y: 200, w: 600, h: 600, memberIds: [], membersListed: true };
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
        const holder = { ...frame, id: 'holder', x: 300, y: 300, w: 400, h: 400, memberIds: [], membersListed: true };
        const big = { ...frame, id: 'big', memberIds: ['holder'] };

        expect(joinGroupUnder(canvas([holder, big]), 'big')).toEqual([holder, big]);
    });
});

describe('joining a named group', () => {
    test('a node is written into the group it was put with and out of the one that held it, wherever it stands', () => {
        const held: ProjectNode = { ...frame, memberIds: ['member'] };
        const other: ProjectNode = { ...frame, id: 'other', x: 5000, memberIds: [], membersListed: true };
        const nodes = joinGroup(canvas([held, other, member]), 'member', 'other');

        expect(nodes.find((node) => node.id === 'frame')?.memberIds).toEqual([]);
        expect(nodes.find((node) => node.id === 'other')?.memberIds).toEqual(['member']);
    });
});

describe('groups grown around their members', () => {
    const tight: ProjectNode = { ...frame, x: 0, y: 0, w: 400, h: 400, memberIds: ['member'] };
    const containers = new Map([['member', 'frame']]);

    test('a frame grows on the side its member sticks out of, with the room a group keeps, and never shrinks', () => {
        const right = { ...member, x: 100, y: 100, w: 600, h: 100 };
        const above = { ...member, x: 100, y: -200, w: 100, h: 100 };
        const frameOf = (grown: ProjectNode) => groupsGrownAround(canvas([tight, grown]), ['member'], containers)[0];

        expect(frameOf(right)).toMatchObject({ x: 0, y: 0, w: 100 + 600 + GROUP_PADDING, h: 400 });
        expect(frameOf(above)).toMatchObject({ x: 0, y: -200 - GROUP_PADDING - GROUP_HEADER, w: 400, h: 400 + 200 + GROUP_PADDING + GROUP_HEADER });
        expect(frameOf({ ...member, x: 100, y: 100 })).toEqual(tight);
    });

    test('a group inside a group grows first, then the one around it', () => {
        const outer: ProjectNode = { ...frame, id: 'outer', x: -100, y: -100, w: 600, h: 600, memberIds: ['frame'] };
        const wide = { ...member, x: 100, y: 100, w: 900, h: 100 };
        const nodes = groupsGrownAround(canvas([outer, tight, wide]), ['member'], new Map([...containers, ['frame', 'outer']]));
        const inner = nodes.find((node) => node.id === 'frame')!;

        expect(inner.w).toBe(100 + 900 + GROUP_PADDING);
        expect(nodes.find((node) => node.id === 'outer')!.w).toBe(inner.x + inner.w + GROUP_PADDING + 100);
    });

    test('a collapsed group keeps its header and grows the height it opens to', () => {
        const folded: ProjectNode = { ...tight, collapsed: true, h: 40, expandedHeight: 400 };
        const tall = { ...member, x: 100, y: 100, w: 100, h: 900 };

        expect(groupsGrownAround(canvas([folded, tall]), ['member'], containers)[0]).toMatchObject({ h: 40, expandedHeight: 100 + 900 + GROUP_PADDING });
    });

    test('a frame that reads its members off positions grows too, but stays as it is where growing would take in another node', () => {
        const geometric: ProjectNode = { ...tight, memberIds: undefined };
        const wide = { ...member, x: 100, y: 100, w: 900, h: 100 };
        const bystander: ProjectNode = { ...member, id: 'bystander', x: 700, y: 300, w: 100, h: 100 };

        expect(groupsGrownAround(canvas([geometric, wide]), ['member'], containers)[0]!.w).toBe(100 + 900 + GROUP_PADDING);
        expect(groupsGrownAround(canvas([geometric, wide, bystander]), ['member'], containers)[0]).toEqual(geometric);
    });
});
