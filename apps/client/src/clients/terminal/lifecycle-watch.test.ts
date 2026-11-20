import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, ProjectNode } from '@ruimte/contracts';
import { watchNodes } from '@/clients/terminal/lifecycle-watch';
import { focusedCanvas } from '@/state/canvas';
import type { CanvasPatch } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';

function node(id: string, kind: ProjectNode['kind'] = 'terminal'): ProjectNode {
    return { id, kind, title: id, x: 0, y: 0, w: 100, h: 80 };
}

function view(id: string, nodes: ProjectNode[]): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] };
}

function project(views: ProjectCanvasView[]): ProjectDocument {
    return { version: 3, rev: 1, name: 'p', color: '#000', views };
}

const container: Endpoint = {
    id: 'Xk3p',
    label: 'Container',
    httpBaseUrl: 'http://127.0.0.1:4310',
    wsBaseUrl: 'ws://127.0.0.1:4310',
    reachability: 'lan',
    daemonId: 'Xk3p',
    daemonPublicKey: null
};

let ended: string[] = [];
let gone: string[] = [];
let stop: (() => void) | null = null;

function watch(): () => void {
    return watchNodes((endpointId, id, kind, exit) => (exit === 'closed' ? ended : gone).push(`${endpointId} ${kind}:${id}`));
}

/* A node leaves once the change that took it out has settled, a microtask after it. */
async function settled(): Promise<void> {
    await Promise.resolve();
}

beforeEach(() => {
    ended = [];
    gone = [];
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(project([view('a', [node('t1'), node('c1', 'chat'), node('b1', 'browser')]), view('b', [node('t2')])]), {
        activeViewId: 'a',
        views: {}
    });
    stop = watch();
});

afterEach(() => {
    stop?.();
    stop = null;
    useEndpoints.getState().remove(container.id);
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
});

describe('a view switch', () => {
    test('ends nothing, whatever kind the nodes are', () => {
        useDocument.getState().setActiveView('b');
        useDocument.getState().setActiveView('a');
        expect(ended).toEqual([]);
    });

    test('leaves the canvas holding the view it was asked for', () => {
        useDocument.getState().setActiveView('b');
        expect(focusedCanvas().getState().viewId).toBe('b');
        expect(focusedCanvas().getState().order).toEqual(['t2']);
        useDocument.getState().setActiveView('a');
        expect(focusedCanvas().getState().viewId).toBe('a');
        expect(focusedCanvas().getState().order).toEqual(['t1', 'c1', 'b1']);
    });

    test('never leaves the canvas standing in for a view it does not hold', () => {
        const seen: string[] = [];
        const record = (): void => {
            seen.push(focusedCanvas().getState().order.join());
        };
        const offCanvas = focusedCanvas().subscribe(record);
        const offDocument = useDocument.subscribe(record);
        useDocument.getState().setActiveView('b');
        offCanvas();
        offDocument();
        for (const order of seen) {
            expect(['t1,c1,b1', 't2']).toContain(order);
        }
    });
});

describe('a node leaving the document', () => {
    test('ends by kind', async () => {
        focusedCanvas().getState().select(['t1', 'c1', 'b1']);
        focusedCanvas().getState().deleteSelected();
        await settled();

        expect(ended.sort()).toEqual(['local browser:b1', 'local chat:c1', 'local terminal:t1']);
    });

    test('ends a node on a view that is not on screen', async () => {
        useDocument.getState().deleteView('b');
        await settled();

        expect(ended).toEqual(['local terminal:t2']);
    });

    test('ends nothing when another project swaps in', async () => {
        useDocument.getState().load(project([view('x', [node('t9')])]), { activeViewId: 'x', views: {} });
        await settled();

        expect(ended).toEqual([]);
        expect(gone).toEqual([]);
    });

    test('names the machine it ran on, so the kill goes to that daemon', async () => {
        stop?.();
        useEndpoints.getState().add(container);
        useEndpoints.getState().setActive(container.id);
        stop = watch();
        focusedCanvas().getState().select(['t1']);
        focusedCanvas().getState().deleteSelected();
        await settled();

        expect(ended).toEqual(['Xk3p terminal:t1']);
    });

    test('ends nothing of the machine that is left behind when another one takes over', async () => {
        useEndpoints.getState().add(container);
        useEndpoints.getState().setActive(container.id);
        focusedCanvas().getState().select(['t1', 'c1']);
        focusedCanvas().getState().deleteSelected();
        await settled();

        expect(ended).toEqual([]);
    });
});

describe('a node that stands nowhere for a moment', () => {
    test('keeps its session when the same change places it again', async () => {
        focusedCanvas().getState().select(['c1']);
        focusedCanvas().getState().deleteSelected();
        focusedCanvas().getState().undo();
        await settled();

        expect(focusedCanvas().getState().nodes.c1).toBeDefined();
        expect(ended).toEqual([]);
        expect(gone).toEqual([]);
    });

    test('keeps its session when it comes back as a view of another kind', async () => {
        focusedCanvas().getState().select(['c1']);
        focusedCanvas().getState().deleteSelected();
        useDocument.getState().addStandaloneView({ kind: 'chat', id: 'c1', name: 'c1', node: {} });
        await settled();

        expect(ended).toEqual([]);
    });

    test('is ended once when it is not placed again, however often it left', async () => {
        focusedCanvas().getState().select(['c1']);
        focusedCanvas().getState().deleteSelected();
        focusedCanvas().getState().undo();
        focusedCanvas().getState().select(['c1']);
        focusedCanvas().getState().deleteSelected();
        await settled();
        await settled();

        expect(ended).toEqual(['local chat:c1']);
    });

    test('ends both of two nodes one change took out', async () => {
        focusedCanvas().getState().select(['t1']);
        focusedCanvas().getState().deleteSelected();
        useDocument.getState().deleteView('b');
        await settled();

        expect(ended.sort()).toEqual(['local terminal:t1', 'local terminal:t2']);
    });

    test('is still ended when the watch stops before the change settled', () => {
        focusedCanvas().getState().select(['t1']);
        focusedCanvas().getState().deleteSelected();
        stop?.();
        stop = null;

        expect(ended).toEqual(['local terminal:t1']);
    });
});

describe('a node another writer took out of the file', () => {
    const without = (id: string): ProjectCanvasView[] =>
        (useDocument.getState().exportViews() as ProjectCanvasView[]).map((entry) => ({ ...entry, nodes: entry.nodes.filter((held) => held.id !== id) }));
    const removal = (id: string): CanvasPatch => ({
        nodes: [],
        texts: [],
        edges: [],
        removed: { nodes: [id], texts: [], edges: [] },
        order: focusedCanvas()
            .getState()
            .order.filter((held) => held !== id),
        layouts: null
    });

    test('is only let go of here when it stood on screen, never ended', async () => {
        useDocument.getState().applyMerge(without('b1'), { a: removal('b1') }, [], {});
        await settled();

        expect(focusedCanvas().getState().nodes.b1).toBeUndefined();
        expect(ended).toEqual([]);
        expect(gone).toEqual(['local browser:b1']);
    });

    test('is only let go of here when it stood on a view that is not on screen, never ended', async () => {
        useDocument.getState().applyMerge(without('t2'), {}, [], {});
        await settled();

        expect(ended).toEqual([]);
        expect(gone).toEqual(['local terminal:t2']);
    });

    test('is only let go of here when the project on screen is read again without it, never ended', async () => {
        useDocument.getState().reload(project(without('b1')), { activeViewId: 'a', views: {} });
        await settled();

        expect(focusedCanvas().getState().nodes.b1).toBeUndefined();
        expect(ended).toEqual([]);
        expect(gone).toEqual(['local browser:b1']);
    });

    test('leaves a close made here right after it ending as before', async () => {
        useDocument.getState().applyMerge(without('t2'), {}, [], {});
        focusedCanvas().getState().select(['t1']);
        focusedCanvas().getState().deleteSelected();
        await settled();

        expect(ended).toEqual(['local terminal:t1']);
        expect(gone).toEqual(['local terminal:t2']);
    });
});
