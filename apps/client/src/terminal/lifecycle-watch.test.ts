import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, ProjectNode } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { watchNodes } from '@/terminal/lifecycle-watch';

const node = (id: string, kind: ProjectNode['kind'] = 'terminal'): ProjectNode => ({ id, kind, title: id, x: 0, y: 0, w: 100, h: 80 });

const view = (id: string, nodes: ProjectNode[]): ProjectCanvasView => ({ kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] });

const project = (views: ProjectCanvasView[]): ProjectDocument => ({ version: 2, rev: 1, name: 'p', color: '#000', views });

const container: Endpoint = {
    id: 'Xk3p',
    label: 'Container',
    httpBaseUrl: 'http://127.0.0.1:4310',
    wsBaseUrl: 'ws://127.0.0.1:4310',
    reachability: 'lan',
    token: 'token',
    daemonId: 'Xk3p',
    daemonPublicKey: null
};

let ended: string[] = [];
let stop: (() => void) | null = null;

beforeEach(() => {
    ended = [];
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(project([view('a', [node('t1'), node('c1', 'chat'), node('b1', 'browser')]), view('b', [node('t2')])]), {
        activeViewId: 'a',
        views: {}
    });
    stop = watchNodes((endpointId, id, kind) => ended.push(`${endpointId} ${kind}:${id}`));
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
    test('ends by kind', () => {
        focusedCanvas().getState().select(['t1', 'c1', 'b1']);
        focusedCanvas().getState().deleteSelected();
        expect(ended.sort()).toEqual(['local browser:b1', 'local chat:c1', 'local terminal:t1']);
    });

    test('ends a node on a view that is not on screen', () => {
        useDocument.getState().deleteView('b');
        expect(ended).toEqual(['local terminal:t2']);
    });

    test('ends nothing when another project swaps in', () => {
        useDocument.getState().load(project([view('x', [node('t9')])]), { activeViewId: 'x', views: {} });
        expect(ended).toEqual([]);
    });

    test('names the machine it ran on, so the kill goes to that daemon', () => {
        stop?.();
        useEndpoints.getState().add(container);
        useEndpoints.getState().setActive(container.id);
        stop = watchNodes((endpointId, id, kind) => ended.push(`${endpointId} ${kind}:${id}`));
        focusedCanvas().getState().select(['t1']);
        focusedCanvas().getState().deleteSelected();
        expect(ended).toEqual(['Xk3p terminal:t1']);
    });

    test('ends nothing of the machine that is left behind when another one takes over', () => {
        useEndpoints.getState().add(container);
        useEndpoints.getState().setActive(container.id);
        focusedCanvas().getState().select(['t1', 'c1']);
        focusedCanvas().getState().deleteSelected();
        expect(ended).toEqual([]);
    });
});
