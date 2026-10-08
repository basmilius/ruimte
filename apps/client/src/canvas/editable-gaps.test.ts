import { describe, expect, test } from 'bun:test';
import { createCanvasStore, type CanvasNode } from '@/state/canvas';
import { editableGaps, gapOffsets } from './editable-gaps';

function node(id: string, x: number, y = 0, kind: CanvasNode['kind'] = 'note'): CanvasNode {
    return { id, kind, title: id, x, y, w: 100, h: 100 };
}

describe('editable gaps', () => {
    test('without a selection, equal adjacent gaps change together from either handle', () => {
        const nodes = [node('c', 264), node('a', 0), node('b', 132)];
        const gaps = editableGaps(nodes, []);
        expect(gaps.map((gap) => gap.id).sort()).toEqual(['x:a:b', 'x:b:c']);
        for (const gap of gaps) {
            expect(gap.shared).toBe(true);
            expect(gap.fixed).toEqual(['a']);
            expect(gapOffsets(gap, 16, false)).toEqual({ b: { x: 16, y: 0 }, c: { x: 32, y: 0 } });
            expect(gapOffsets(gap, -1000, true)).toEqual({ b: { x: -32, y: 0 }, c: { x: -64, y: 0 } });
        }
    });

    test('shrinking the first gap in the terminal row also shrinks the second by the same amount', () => {
        const nodes = [66, 732, 1398].map((x, index) => ({ ...node(String(index), x), w: 597, h: 384 }));
        const gap = editableGaps(nodes, []).find((gap) => gap.from === '0')!;
        const offsets = gapOffsets(gap, -21, false);
        const moved = nodes.map((node) => ({ ...node, x: node.x + (offsets[node.id]?.x ?? 0) }));
        expect(moved[0]!.x).toBe(66);
        expect(moved[1]!.x - moved[0]!.x - moved[0]!.w).toBe(48);
        expect(moved[2]!.x - moved[1]!.x - moved[1]!.w).toBe(48);
    });

    test('without a selection, unequal gaps are edited independently', () => {
        const gaps = editableGaps([node('a', 0), node('b', 132), node('c', 280)], []);
        expect(gaps.every((gap) => !gap.shared)).toBe(true);
        expect(
            gapOffsets(
                gaps.find((gap) => gap.from === 'a')!,
                16,
                false
            )
        ).toEqual({ b: { x: 16, y: 0 } });
    });

    test('equal gaps in another row do not move with the edited row', () => {
        const gaps = editableGaps([node('a', 0), node('b', 132), node('c', 264), node('d', 0, 200), node('e', 132, 200), node('f', 264, 200)], []);
        const gap = gaps.find((gap) => gap.id === 'x:a:b')!;
        expect(gapOffsets(gap, -16, false)).toEqual({ b: { x: -16, y: 0 }, c: { x: -32, y: 0 } });
    });

    test('diagonal chains and branching neighbors do not share gaps', () => {
        const diagonal = editableGaps([node('a', 0), node('b', 132, 75), node('c', 264, 150)], []);
        expect(diagonal.every((gap) => !gap.shared)).toBe(true);
        const branch = editableGaps([node('a', 0), node('b', 0, 100), { ...node('c', 132), h: 200 }, { ...node('d', 264), h: 200 }], []);
        expect(branch.every((gap) => !gap.shared)).toBe(true);
    });

    test('equal gaps in a column also shrink together without a selection', () => {
        const gaps = editableGaps([node('a', 0), node('b', 0, 132), node('c', 0, 264)], []);
        expect(gaps.every((gap) => gap.shared)).toBe(true);
        expect(gapOffsets(gaps[0]!, -16, false)).toEqual({ b: { x: 0, y: -16 }, c: { x: 0, y: -32 } });
    });

    test('without a selection, vertical gaps move down and unrelated or overlapping nodes offer no gap', () => {
        const gap = editableGaps([node('top', 0), node('bottom', 0, 132)], [])[0]!;
        expect(gap.fixed).toEqual(['top']);
        expect(gapOffsets(gap, 16, false)).toEqual({ bottom: { x: 0, y: 16 } });
        expect(editableGaps([node('a', 0), node('overlapping', 90)], [])).toEqual([]);
        expect(editableGaps([node('a', 0), node('overlapping', 90), node('c', 232)], []).map((gap) => gap.id)).toEqual(['x:overlapping:c']);
        expect(editableGaps([node('a', 0), node('diagonal', 132, 132)], [])).toEqual([]);
        expect(editableGaps([node('alone', 0)], [])).toEqual([]);
        expect(editableGaps([], [])).toEqual([]);
    });

    test('without a selection, gaps stay within the same group level', () => {
        const nodes = [{ ...node('g', -24, -48, 'group'), w: 400, h: 200 }, node('a', 0), node('b', 132), node('outside', 500)];
        expect(
            editableGaps(nodes, [])
                .map((gap) => gap.id)
                .sort()
        ).toEqual(['x:a:b', 'x:g:outside']);
    });

    test('equal gaps move later nodes by multiples of the change, independent of selection order', () => {
        const gaps = editableGaps([node('a', 0), node('b', 132), node('c', 264)], ['c', 'a', 'b']);
        expect(gaps).toHaveLength(2);
        expect(gaps.every((gap) => gap.shared)).toBe(true);
        for (const gap of gaps) {
            expect(gap.fixed).toEqual(['a']);
            expect(gapOffsets(gap, 16, false)).toEqual({ b: { x: 16, y: 0 }, c: { x: 32, y: 0 } });
        }
    });

    test('unequal gaps change only the chosen gap while carrying the rest of the row', () => {
        const gaps = editableGaps([node('a', 0), node('b', 132), node('c', 280)], ['a', 'b', 'c']);
        expect(gaps.every((gap) => !gap.shared)).toBe(true);
        expect(gapOffsets(gaps[0]!, 16, false)).toEqual({ b: { x: 16, y: 0 }, c: { x: 16, y: 0 } });
        expect(gapOffsets(gaps[1]!, 16, false)).toEqual({ c: { x: 16, y: 0 } });
    });

    test('a single selected node moves with the pointer and its nearest neighbor stays put', () => {
        const gaps = editableGaps([node('left', -132), node('picked', 0), node('right', 132), node('far', 500)], ['picked']);
        expect(gaps.map((gap) => gap.id)).toEqual(['x:left:picked', 'x:picked:right']);
        expect(gapOffsets(gaps[0]!, 10, true)).toEqual({ picked: { x: 10, y: 0 } });
        expect(gapOffsets(gaps[1]!, 10, true)).toEqual({ picked: { x: 10, y: 0 } });
        expect(gapOffsets(gaps[1]!, 1000, true)).toEqual({ picked: { x: 32, y: 0 } });
    });

    test('vertical gaps, zero minimum and overlapping selections', () => {
        const gap = editableGaps([node('a', 0), node('b', 0, 132)], ['a', 'b'])[0]!;
        expect(gapOffsets(gap, -1000, false)).toEqual({ b: { x: 0, y: -32 } });
        expect(editableGaps([node('a', 0), node('b', 90)], ['a', 'b'])).toEqual([]);
        expect(editableGaps([node('a', 0), node('b', 132, 132)], ['a', 'b'])).toEqual([]);
    });

    test('a group and its own children do not form a row, while siblings in the group do', () => {
        const nodes = [{ ...node('g', -24, -48, 'group'), w: 400, h: 200 }, node('a', 0), node('b', 132), node('outside', 500)];
        expect(editableGaps(nodes, ['a', 'g'])).toEqual([]);
        expect(editableGaps(nodes, ['a', 'outside'])).toEqual([]);
        expect(editableGaps(nodes, ['a', 'b'])).toHaveLength(1);
    });

    test('a row cannot edit a gap across an unselected sibling', () => {
        const nodes = [node('a', 0), node('between', 132), node('b', 264)];
        expect(editableGaps(nodes, ['a', 'b'])).toEqual([]);
        expect(editableGaps([nodes[0]!, { ...nodes[1]!, y: 200 }, nodes[2]!], ['a', 'b'])).toHaveLength(1);
    });
});

describe('a gap move as one placement edit', () => {
    test('a group carries its nodes and text, keeps the selection, and undoes in one step', () => {
        const store = createCanvasStore();
        store.setState({
            nodes: { a: node('a', 0), g: { ...node('g', 132, 0, 'group'), w: 300, h: 300 }, inside: node('inside', 160, 80) },
            texts: { text: { id: 'text', x: 180, y: 250, text: 'Note', size: 18 } },
            selection: ['a', 'g']
        });
        store.getState().beginGapMove(['g']);
        expect(store.getState().heldNodeIds().sort()).toEqual(['g', 'inside', 'text']);
        store.getState().moveGapNodes({ g: { x: 16, y: 0 } });
        store.getState().moveGapNodes({ g: { x: 32, y: 0 } });
        expect(store.getState().past).toHaveLength(0);
        expect(store.getState().nodes.inside!.x).toBe(192);
        expect(store.getState().texts.text!.x).toBe(212);
        store.getState().endGapMove();
        expect(store.getState().past).toHaveLength(1);
        expect(store.getState().selection).toEqual(['a', 'g']);
        store.getState().undo();
        expect(store.getState().nodes.g!.x).toBe(132);
        expect(store.getState().nodes.inside!.x).toBe(160);
        expect(store.getState().texts.text!.x).toBe(180);
    });

    test('cancel restores only positions and keeps concurrent edits and additions', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: node('a', 0) }, order: ['a'] });
        store.getState().beginGapMove(['a']);
        store.getState().moveGapNodes({ a: { x: 16, y: 0 } });
        store.getState().renameNode('a', 'Renamed');
        store.getState().applyExternal({
            nodes: [node('new', 500)],
            texts: [],
            edges: [],
            layouts: null,
            order: ['a', 'new'],
            removed: { nodes: [], texts: [], edges: [] }
        });
        store.getState().endGapMove(true);
        expect(store.getState().nodes.a).toMatchObject({ x: 0, title: 'Renamed' });
        expect(store.getState().nodes.new).toBeDefined();
        expect(store.getState().past).toHaveLength(0);
    });

    test('undo keeps concurrent additions and does not resurrect nodes removed during a drag', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: node('a', 0), b: node('b', 132) }, order: ['a', 'b'] });
        store.getState().beginGapMove(['a', 'b']);
        store.getState().moveGapNodes({ a: { x: 16, y: 0 }, b: { x: 32, y: 0 } });
        store.getState().applyExternal({
            nodes: [node('new', 500)],
            texts: [],
            edges: [],
            layouts: null,
            order: ['a', 'new'],
            removed: { nodes: ['b'], texts: [], edges: [] }
        });
        store.getState().endGapMove();
        store.getState().undo();
        expect(store.getState().nodes.a!.x).toBe(0);
        expect(store.getState().nodes.b).toBeUndefined();
        expect(store.getState().nodes.new).toBeDefined();
    });

    test('move lock and a drag returning to its origin create no history step', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { a: node('a', 0) }, locks: { pan: false, zoom: false, move: true, resize: false } });
        expect(store.getState().beginGapMove(['a'])).toBe(false);
        store.getState().toggleLock('move');
        store.getState().beginGapMove(['a']);
        store.getState().moveGapNodes({ a: { x: 16, y: 0 } });
        store.getState().moveGapNodes({ a: { x: 0, y: 0 } });
        store.getState().endGapMove();
        expect(store.getState().past).toHaveLength(0);
    });

    test('the fixed neighbor is held and a parent grows to keep moved children inside', () => {
        const store = createCanvasStore();
        store.setState({ nodes: { g: { ...node('g', -24, -48, 'group'), w: 280, h: 180 }, a: node('a', 0), b: node('b', 132) } });
        store.getState().beginGapMove(['b'], ['a']);
        expect(store.getState().heldNodeIds().sort()).toEqual(['a', 'b', 'g']);
        store.getState().moveGapNodes({ b: { x: 200, y: 0 } });
        store.getState().endGapMove();
        const { g, b } = store.getState().nodes;
        expect(g!.x + g!.w).toBeGreaterThan(b!.x + b!.w);
        store.getState().undo();
        expect(store.getState().nodes.g!.w).toBe(280);
    });
});
