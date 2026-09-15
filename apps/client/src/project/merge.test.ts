import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectContent, ProjectNode, ProjectView } from '@ruimte/contracts';
import { mergeProject, type ProjectMerge } from './merge';

const node = (id: string, patch: Partial<ProjectNode> = {}): ProjectNode => ({
    id,
    kind: 'note',
    title: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...patch
});

const canvas = (id: string, patch: Partial<ProjectCanvasView> = {}): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes: [],
    texts: [],
    edges: [],
    layouts: [],
    ...patch
});

const content = (views: ProjectView[], patch: Partial<ProjectContent> = {}): ProjectContent => ({
    name: 'p',
    color: '#000',
    views,
    ...patch
});

const canvasOf = (merge: ProjectMerge, id: string): ProjectCanvasView => {
    if (!merge.ok) {
        throw new Error(`merge refused: ${merge.reason}`);
    }
    return merge.content.views.find((view) => view.id === id) as ProjectCanvasView;
};

describe('what is additive', () => {
    test('a node the daemon added lands beside the edit in progress', () => {
        const base = content([canvas('main', { nodes: [node('a')] })]);
        const mine = content([canvas('main', { nodes: [node('a', { x: 400 }), node('mine')] })]);
        const theirs = content([canvas('main', { nodes: [node('a'), node('agent')] })]);

        const merge = mergeProject(base, mine, theirs);
        expect(merge.ok).toBe(true);
        // The node this client moved keeps where the person left it, and the one it made stays put.
        expect(canvasOf(merge, 'main').nodes).toEqual([node('a', { x: 400 }), node('mine'), node('agent')]);
        expect((merge as { additions: { canvases: Record<string, { nodes: ProjectNode[] }> } }).additions.canvases.main!.nodes).toEqual([node('agent')]);
    });

    test('a text, an edge and a whole view all come over at once', () => {
        const base = content([canvas('main', { nodes: [node('a'), node('b')] })]);
        const mine = base;
        const theirs = content([
            canvas('main', {
                nodes: [node('a'), node('b')],
                texts: [{ id: 't1', x: 0, y: 0, text: 'hi', size: 16 }],
                edges: [{ id: 'e1', from: 'a', to: 'b' }]
            }),
            canvas('second')
        ]);

        const merge = mergeProject(base, mine, theirs);
        expect(merge.ok).toBe(true);
        expect(canvasOf(merge, 'main').texts).toHaveLength(1);
        expect(canvasOf(merge, 'main').edges).toEqual([{ id: 'e1', from: 'a', to: 'b' }]);
        if (merge.ok) {
            expect(merge.additions.views.map((view) => view.id)).toEqual(['second']);
            expect(merge.content.views.map((view) => view.id)).toEqual(['main', 'second']);
        }
    });

    test('a view arrives where the daemon put it, without moving the views this client added itself', () => {
        const base = content([canvas('main'), canvas('last')]);
        const mine = content([canvas('main'), canvas('local'), canvas('last')]);
        const theirs = content([canvas('main'), canvas('agent'), canvas('last')]);

        const merge = mergeProject(base, mine, theirs);
        expect(merge.ok).toBe(true);
        if (merge.ok) {
            expect(merge.content.views.map((view) => view.id)).toEqual(['main', 'agent', 'local', 'last']);
        }
    });

    test('an incoming document that changed nothing is taken as it is', () => {
        const base = content([canvas('main')]);
        const mine = content([canvas('main', { nodes: [node('mine')] })]);

        const merge = mergeProject(base, mine, base);
        expect(merge.ok).toBe(true);
        expect(canvasOf(merge, 'main').nodes).toEqual([node('mine')]);
        if (merge.ok) {
            expect(merge.additions.canvases).toEqual({});
        }
    });

    test('a node this client already saved does not arrive twice', () => {
        const base = content([canvas('main')]);
        const mine = content([canvas('main', { nodes: [node('a')] })]);
        const theirs = content([canvas('main', { nodes: [node('a'), node('agent')] })]);

        const merge = mergeProject(base, mine, theirs);
        expect(canvasOf(merge, 'main').nodes.map((held) => held.id)).toEqual(['a', 'agent']);
    });

    test('a node put into a collapsed group grows that group and nothing else', () => {
        const group = node('g', { kind: 'group', collapsed: true, memberIds: ['a'] });
        const base = content([canvas('main', { nodes: [group, node('a')] })]);
        const mine = content([canvas('main', { nodes: [{ ...group, x: 900 }, node('a')] })]);
        const theirs = content([canvas('main', { nodes: [{ ...group, memberIds: ['a', 'agent'] }, node('a'), node('agent')] })]);

        const merge = mergeProject(base, mine, theirs);
        expect(merge.ok).toBe(true);
        const merged = canvasOf(merge, 'main').nodes;
        expect(merged[0]).toEqual({ ...group, x: 900, memberIds: ['a', 'agent'] });
        if (merge.ok) {
            expect(merge.additions.canvases.main!.members).toEqual({ g: ['agent'] });
        }
    });

    test('a group that gained a member and moved is a conflict, since the move is not this client to keep', () => {
        const group = node('g', { kind: 'group', collapsed: true, memberIds: ['a'] });
        const base = content([canvas('main', { nodes: [group, node('a')] })]);
        const theirs = content([canvas('main', { nodes: [{ ...group, x: 50, memberIds: ['a', 'agent'] }, node('a'), node('agent')] })]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the node g changed' });
    });
});

describe('what is a conflict', () => {
    test('a node this client knows that moved', () => {
        const base = content([canvas('main', { nodes: [node('a')] })]);
        const theirs = content([canvas('main', { nodes: [node('a', { x: 200 })] })]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the node a changed' });
    });

    test('a node that was removed', () => {
        const base = content([canvas('main', { nodes: [node('a'), node('b')] })]);
        const theirs = content([canvas('main', { nodes: [node('a')] })]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the node b was removed' });
    });

    test('a renamed project, and a recolored one', () => {
        const base = content([canvas('main')]);

        expect(mergeProject(base, base, content([canvas('main')], { name: 'other' }))).toEqual({
            ok: false,
            reason: 'the project was renamed to "other"'
        });
        expect(mergeProject(base, base, content([canvas('main')], { color: '#fff' }))).toEqual({
            ok: false,
            reason: 'the color of the project changed'
        });
    });

    test('a view renamed here and there to different names', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const mine = content([canvas('main'), canvas('notes', { name: 'Thoughts', titleSource: 'user' })]);
        const theirs = content([canvas('main'), canvas('notes', { name: 'Ideas', titleSource: 'user' })]);

        expect(mergeProject(base, mine, theirs)).toEqual({ ok: false, reason: 'the view notes was renamed to "Ideas" there and to "Thoughts" here' });
    });

    test('an edge into a node this canvas does not have', () => {
        const base = content([canvas('main', { nodes: [node('a'), node('b')] })]);
        // The person deleted b here while the agent drew a line to it.
        const mine = content([canvas('main', { nodes: [node('a')] })]);
        const theirs = content([canvas('main', { nodes: [node('a'), node('b')], edges: [{ id: 'e1', from: 'a', to: 'b' }] })]);

        expect(mergeProject(base, mine, theirs)).toEqual({ ok: false, reason: 'the edge e1 runs to b, which this canvas does not have' });
    });

    test('a view that was removed', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const theirs = content([canvas('main')]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the view notes was removed' });
    });

    test('views put in another order here and in a different one there', () => {
        const base = content([canvas('a'), canvas('b'), canvas('c')]);
        const mine = content([canvas('b'), canvas('a'), canvas('c')]);
        const theirs = content([canvas('a'), canvas('c'), canvas('b')]);

        expect(mergeProject(base, mine, theirs)).toEqual({ ok: false, reason: 'the views were put in another order both here and there' });
    });

    test('a standalone view that changed what it holds', () => {
        const base = content([canvas('main'), { kind: 'browser', id: 'b1', name: 'Docs', url: 'https://a' }]);
        const theirs = content([canvas('main'), { kind: 'browser', id: 'b1', name: 'Docs', url: 'https://b' }]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the view b1 changed' });
    });

    test('an arrangement that changed', () => {
        const base = content([canvas('main', { layouts: [{ name: 'wide', nodes: {}, texts: {} }] })]);
        const theirs = content([canvas('main', { layouts: [] })]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the arrangements of view main changed' });
    });

    test('the stacking order of a canvas that changed', () => {
        const base = content([canvas('main', { nodes: [node('a'), node('b')] })]);
        const theirs = content([canvas('main', { nodes: [node('b'), node('a')] })]);

        expect(mergeProject(base, base, theirs)).toEqual({ ok: false, reason: 'the nodes of this canvas were put in another order' });
    });
});

describe('what another client changed about the list', () => {
    const ids = (merge: ProjectMerge): string[] => {
        if (!merge.ok) {
            throw new Error(`merge refused: ${merge.reason}`);
        }
        return merge.content.views.map((view) => view.id);
    };

    test('a view renamed there lands beside a node added here', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const mine = content([canvas('main', { nodes: [node('a')] }), canvas('notes')]);
        const theirs = content([canvas('main'), canvas('notes', { name: 'Ideas', titleSource: 'user' })]);

        const merge = mergeProject(base, mine, theirs);
        expect(canvasOf(merge, 'notes')).toEqual(canvas('notes', { name: 'Ideas', titleSource: 'user' }));
        expect(canvasOf(merge, 'main').nodes.map((item) => item.id)).toEqual(['a']);
        expect(merge.ok && merge.additions).toEqual({ views: [], canvases: {} });
    });

    test('the same rename on both sides is no conflict', () => {
        const base = content([canvas('main')]);
        const renamed = content([canvas('main', { name: 'Board', titleSource: 'user' })]);

        expect(canvasOf(mergeProject(base, renamed, renamed), 'main').name).toBe('Board');
    });

    test('a standalone view renamed there takes the name and keeps what it holds', () => {
        const base = content([canvas('main'), { kind: 'browser', id: 'b1', name: 'Docs', url: 'https://a' }]);
        const theirs = content([canvas('main'), { kind: 'browser', id: 'b1', name: 'Reference', titleSource: 'user', url: 'https://a' }]);

        const merge = mergeProject(base, base, theirs);
        expect(merge.ok && merge.content.views[1]).toEqual({ kind: 'browser', id: 'b1', name: 'Reference', titleSource: 'user', url: 'https://a' });
    });

    test('a new order there is taken when this client kept the old one, and its own new view stays behind the one it followed', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const mine = content([canvas('main'), canvas('mine'), canvas('notes')]);
        const theirs = content([canvas('notes'), canvas('main')]);

        expect(ids(mergeProject(base, mine, theirs))).toEqual(['notes', 'main', 'mine']);
    });

    test('a new order there with a new view at the top', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const theirs = content([canvas('third'), canvas('notes'), canvas('main')]);

        expect(ids(mergeProject(base, base, theirs))).toEqual(['third', 'notes', 'main']);
    });

    test('a new order here stays when there only a view was added', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const mine = content([canvas('notes'), canvas('main')]);
        const theirs = content([canvas('main'), canvas('notes'), canvas('third')]);

        expect(ids(mergeProject(base, mine, theirs))).toEqual(['notes', 'third', 'main']);
    });

    test('the same new order on both sides is no conflict', () => {
        const base = content([canvas('main'), canvas('notes')]);
        const moved = content([canvas('notes'), canvas('main')]);

        expect(ids(mergeProject(base, moved, moved))).toEqual(['notes', 'main']);
    });
});

describe('what went through JSON', () => {
    test('a key that is absent and one that is undefined are the same node', () => {
        const base = content([canvas('main', { nodes: [{ ...node('a'), titleSource: undefined, accent: undefined }] })]);
        const theirs = content([canvas('main', { nodes: [node('a'), node('agent')] })]);

        const merge = mergeProject(base, base, theirs);
        expect(merge.ok).toBe(true);
    });
});

describe('what a newer Ruimte wrote', () => {
    const hologram: ProjectNode = {
        id: 'holo',
        kind: 'unknown',
        title: 'Hologram',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        raw: { kind: 'hologram', id: 'holo', title: 'Hologram', x: 0, y: 0, w: 100, h: 100, beam: { lumens: [1, 2] } }
    };
    const timeline: ProjectView = { kind: 'unknown', id: 'timeline', name: 'Flow', raw: { kind: 'timeline', id: 'timeline', name: 'Flow', tracks: [] } };

    test('a node and a view of an unknown kind stay where they are when the daemon adds something', () => {
        const base = content([canvas('main', { nodes: [node('a'), hologram] }), timeline]);
        const mine = content([canvas('main', { nodes: [node('a', { x: 400 }), hologram] }), timeline]);
        const theirs = content([canvas('main', { nodes: [node('a'), hologram, node('agent')] }), timeline]);

        const merge = mergeProject(base, mine, theirs);
        expect(merge.ok).toBe(true);
        expect(canvasOf(merge, 'main').nodes).toEqual([node('a', { x: 400 }), hologram, node('agent')]);
        expect((merge as { content: ProjectContent }).content.views[1]).toEqual(timeline);
    });

    test('an unknown view the daemon added arrives like any other view', () => {
        const base = content([canvas('main')]);
        const theirs = content([canvas('main'), timeline]);
        const merge = mergeProject(base, base, theirs);
        expect(merge.ok).toBe(true);
        expect((merge as { additions: { views: ProjectView[] } }).additions.views).toEqual([timeline]);
    });
});
