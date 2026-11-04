import { describe, expect, test } from 'bun:test';
import { GROUP_HEADER, GROUP_PADDING } from '@ruimte/contracts';
import type { CanvasNode } from '@/state/canvas';
import { createCanvasStore } from '@/state/canvas';
import { arrangeGroupMembers, groupArrangeable } from './arrange-group';

function node(id: string, x: number, y: number, patch: Partial<CanvasNode> = {}): CanvasNode {
    return { id, kind: 'terminal', title: id, x, y, w: 200, h: 100, ...patch };
}

function group(id: string, x: number, y: number, w: number, h: number, patch: Partial<CanvasNode> = {}): CanvasNode {
    return node(id, x, y, { kind: 'group', w, h, ...patch });
}

function byId(...list: CanvasNode[]): Record<string, CanvasNode> {
    return Object.fromEntries(list.map((entry) => [entry.id, entry]));
}

describe('arranging the members of a group', () => {
    test('the grid lands inside the frame, under the title bar', () => {
        const nodes = byId(group('g', 0, 0, 800, 600), node('a', 300, 300), node('b', 40, 60), node('c', 500, 40), node('d', 100, 400));
        const result = arrangeGroupMembers('g', nodes, {});
        if ('refused' in result) {
            throw new Error(result.refused);
        }
        const placed = Object.entries(result.moves).map(([id, at]) => ({ ...nodes[id]!, ...at }));
        expect(placed.length).toBeGreaterThan(0);
        for (const member of placed) {
            expect(member.x).toBeGreaterThanOrEqual(GROUP_PADDING);
            expect(member.y).toBeGreaterThanOrEqual(GROUP_HEADER + GROUP_PADDING);
            expect(member.x + member.w).toBeLessThanOrEqual(result.frame.x + result.frame.w - GROUP_PADDING);
            expect(member.y + member.h).toBeLessThanOrEqual(result.frame.y + result.frame.h - GROUP_PADDING);
        }
    });

    test('a group inside it moves as one block with what it holds', () => {
        const nodes = byId(group('outer', 0, 0, 1400, 900), group('inner', 700, 400, 500, 400), node('inside', 740, 480), node('loose', 60, 80));
        const result = arrangeGroupMembers('outer', nodes, {});
        if ('refused' in result) {
            throw new Error(result.refused);
        }
        const innerDelta = { x: result.moves.inner!.x - 700, y: result.moves.inner!.y - 400 };
        expect(result.moves.inside).toEqual({ x: 740 + innerDelta.x, y: 480 + innerDelta.y });
    });

    test('a loose node the grown frame would cover refuses the arrange', () => {
        const nodes = byId(
            group('g', 0, 0, 500, 300),
            node('a', 0, 40),
            node('b', 280, 40),
            node('c', 0, 190),
            node('d', 280, 190),
            node('neighbor', 402, 100)
        );
        expect(arrangeGroupMembers('g', nodes, {})).toEqual({ refused: 'membership' });
    });

    test('a collapsed group and an empty one are refused', () => {
        expect(arrangeGroupMembers('g', byId(group('g', 0, 0, 800, 600, { collapsed: true, memberIds: ['a'] }), node('a', 10, 10)), {})).toEqual({
            refused: 'collapsed'
        });
        expect(arrangeGroupMembers('g', byId(group('g', 0, 0, 800, 600)), {})).toEqual({ refused: 'empty' });
    });

    test('a collapsed group inside it carries the members it hid', () => {
        const nested = group('inner', 700, 400, 500, 40, { collapsed: true, memberIds: ['hidden'], expandedHeight: 400 });
        const nodes = byId(group('outer', 0, 0, 1400, 900), nested, node('hidden', 3000, 3000), node('loose', 60, 80));
        const result = arrangeGroupMembers('outer', nodes, {});
        if ('refused' in result) {
            throw new Error(result.refused);
        }
        expect(result.moves.inner).toBeDefined();
        expect(result.moves.hidden).toEqual({ x: 3000 + result.moves.inner!.x - 700, y: 3000 + result.moves.inner!.y - 400 });
    });

    test('a node landing in the expanded rect of a collapsed group stays out of it, since that group spells out its members', () => {
        const hiding = group('c', 300, -100, 300, 40, { collapsed: true, memberIds: ['m'], expandedHeight: 400 });
        const nodes = byId(group('g', 0, 0, 500, 400), hiding, node('m', 3000, 3000), node('a', 20, 60), node('b', 20, 170), node('d', 20, 280));
        expect(arrangeGroupMembers('g', nodes, {})).not.toEqual({ refused: 'membership' });
    });

    test('the command is offered for an open group on an unlocked canvas only', () => {
        const unlocked = { move: false };
        expect(groupArrangeable(group('g', 0, 0, 100, 100), unlocked)).toBe(true);
        expect(groupArrangeable(group('g', 0, 0, 100, 100, { collapsed: true }), unlocked)).toBe(false);
        expect(groupArrangeable(group('g', 0, 0, 100, 100), { move: true })).toBe(false);
        expect(groupArrangeable(node('a', 0, 0), unlocked)).toBe(false);
        expect(groupArrangeable(undefined, unlocked)).toBe(false);
    });

    test('the store arranges in one undo step and leaves the edges alone', () => {
        const store = createCanvasStore();
        const edges = [{ id: 'e1', from: 'a', to: 'b' }];
        const nodes = byId(group('g', 0, 0, 800, 600), node('a', 300, 300), node('b', 40, 60), node('c', 500, 40));
        store.setState({ nodes, order: Object.keys(nodes), texts: {}, edges });
        const before = structuredClone(store.getState().nodes);
        expect(store.getState().arrangeGroup('g')).toMatchObject({ moved: expect.any(Array) });
        expect(store.getState().nodes).not.toEqual(before);
        expect(store.getState().edges).toBe(edges);
        store.getState().undo();
        expect(store.getState().nodes).toEqual(before);
    });

    test('a locked canvas refuses', () => {
        const store = createCanvasStore();
        const nodes = byId(group('g', 0, 0, 800, 600), node('a', 300, 300));
        store.setState({ nodes, order: Object.keys(nodes), texts: {}, locks: { pan: false, zoom: false, move: true, resize: false } });
        expect(store.getState().arrangeGroup('g')).toEqual({ refused: 'locked' });
    });
});
