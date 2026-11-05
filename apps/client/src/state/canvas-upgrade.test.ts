import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { carriedByGroups, createCanvasStore } from './canvas';

/*
 * A canvas as 0.29 wrote it: an open group names no members and holds what has its center in its
 * frame, while a collapsed one names them. `inner` stands inside `outer`, so 0.29 showed `x` in both.
 */
function node(id: string, x: number, y: number, size: Partial<ProjectNode> = {}): ProjectNode {
    return { id, kind: 'note', title: id, x, y, w: 200, h: 100, ...size };
}

function group(id: string, x: number, y: number, w: number, h: number, patch: Partial<ProjectNode> = {}): ProjectNode {
    return node(id, x, y, { kind: 'group', w, h, ...patch });
}

function fromOlderRuimte(): ProjectCanvasView {
    return {
        kind: 'canvas',
        id: 'main',
        name: 'Canvas',
        nodes: [
            group('outer', 0, 0, 1600, 1200),
            group('inner', 800, 400, 600, 600),
            node('x', 900, 500),
            node('y', 100, 100),
            group('shut', 3000, 0, 800, 40, { collapsed: true, expandedHeight: 600, memberIds: ['s'] }),
            node('s', 3100, 100),
            node('free', 6000, 0)
        ],
        texts: [],
        edges: [],
        layouts: []
    };
}

function loaded(view: ProjectCanvasView = fromOlderRuimte()) {
    const store = createCanvasStore();
    store.getState().loadView(view, null);
    return store;
}

function held(store: ReturnType<typeof createCanvasStore>, id: string): string[] {
    const { nodes, texts, lines } = store.getState();
    return [...carriedByGroups(nodes, texts, [id], lines)].sort();
}

function membership(store: ReturnType<typeof createCanvasStore>): Record<string, string[]> {
    return { outer: held(store, 'outer'), inner: held(store, 'inner'), shut: held(store, 'shut') };
}

function drag(store: ReturnType<typeof createCanvasStore>, ids: string[], dx: number, dy: number): void {
    store.getState().select(ids);
    store.getState().moveSelected(dx, dy, true);
    store.getState().settleMove();
}

const AS_SHOWN = { outer: ['inner', 'x', 'y'], inner: ['x'], shut: ['s'] };

describe('a canvas an older Ruimte wrote', () => {
    test('loads with the members it showed, and keeps the collapsed group shut over its own', () => {
        const store = loaded();

        expect(membership(store)).toEqual(AS_SHOWN);
        expect([...store.getState().hidden]).toEqual(['s']);
        expect(store.getState().nodes.outer!.memberIds).toBeUndefined();
    });

    test('the first drag writes every group out without changing what is in which', () => {
        const store = loaded();

        drag(store, ['free'], 400, 0);

        const nodes = store.getState().nodes;

        expect(membership(store)).toEqual(AS_SHOWN);
        expect([nodes.outer!.memberIds, nodes.inner!.memberIds, nodes.shut!.memberIds].every((ids) => ids !== undefined)).toBe(true);
    });

    test('the first node added inside a frame joins it and leaves the rest as they were', () => {
        const store = loaded();

        const added = store.getState().addNode('note', { x: 300, y: 900 })!;

        expect(membership(store)).toEqual({ ...AS_SHOWN, outer: [added, 'inner', 'x', 'y'].sort() });
    });

    test('the first collapse hides what the group showed, and the group around it still holds it all', () => {
        const store = loaded();

        store.getState().toggleCollapse('inner');

        expect(membership(store)).toEqual(AS_SHOWN);
        expect([...store.getState().hidden].sort()).toEqual(['s', 'x']);
    });

    test('a nested group dragged out of the frame takes its members along and leaves nothing of them behind', () => {
        const store = loaded();
        drag(store, ['free'], 400, 0);

        drag(store, ['inner'], 0, 2000);

        expect(held(store, 'outer')).toEqual(['y']);
        expect(held(store, 'inner')).toEqual(['x']);

        const left = store.getState().nodes.x!.y;
        drag(store, ['outer'], 0, -400);

        expect(store.getState().nodes.x!.y).toBe(left);
    });

    test('open groups a 0.29 iPhone wrote an empty list on keep what stands in them, through a drag and a new group', () => {
        const view = fromOlderRuimte();
        // A deletion on a 0.29 iPhone wrote `memberIds: []` on every group without a list.
        view.nodes = view.nodes.map((candidate) => (candidate.kind === 'group' && candidate.collapsed !== true ? { ...candidate, memberIds: [] } : candidate));
        const store = loaded(view);

        expect(membership(store)).toEqual(AS_SHOWN);

        drag(store, ['free'], 400, 0);
        store.getState().addNode('group', { x: 4000, y: 3000 });

        expect(membership(store)).toEqual(AS_SHOWN);
    });

    test('a group emptied on this version is saved as holding nothing, whatever stands in its frame when it is read again', () => {
        const store = loaded();
        drag(store, ['free'], 400, 0);
        drag(store, ['x'], 0, 2000);

        const saved = store.getState().exportContent();
        const reread = loaded({
            ...fromOlderRuimte(),
            ...saved,
            nodes: saved.nodes.map((candidate) => (candidate.id === 'x' ? { ...candidate, y: 500 } : candidate))
        });

        expect(held(reread, 'inner')).toEqual([]);
    });

    test('a group 0.29 folded names what its nested groups hold, and once opened lets those go with them too', () => {
        const view = fromOlderRuimte();
        // 0.29 folded `outer` with every id whose center stood in its frame, the nested ones included.
        view.nodes[0] = group('outer', 0, 0, 1600, 40, { collapsed: true, expandedHeight: 1200, memberIds: ['inner', 'x', 'y'] });
        const store = loaded(view);

        expect(held(store, 'outer')).toEqual(AS_SHOWN.outer);

        store.getState().toggleCollapse('outer');
        drag(store, ['inner'], 0, 2000);

        expect(held(store, 'outer')).toEqual(['y']);
        expect(held(store, 'inner')).toEqual(['x']);
    });
});
