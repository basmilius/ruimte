import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, ProjectNode } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { watchNodes } from '@/terminal/lifecycle-watch';

const node = (id: string, kind: ProjectNode['kind'] = 'terminal'): ProjectNode => ({ id, kind, title: id, x: 0, y: 0, w: 100, h: 80 });

const view = (id: string, nodes: ProjectNode[]): ProjectCanvasView => ({ kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] });

const project = (views: ProjectCanvasView[]): ProjectDocument => ({ version: 2, rev: 1, name: 'p', color: '#000', views });

let ended: string[] = [];
let stop: (() => void) | null = null;

beforeEach(() => {
    ended = [];
    useCanvas.getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(project([view('a', [node('t1'), node('c1', 'chat'), node('b1', 'browser')]), view('b', [node('t2')])]), {
        activeViewId: 'a',
        views: {}
    });
    stop = watchNodes((id, kind) => ended.push(`${kind}:${id}`));
});

afterEach(() => {
    stop?.();
    stop = null;
});

describe('a view switch', () => {
    test('ends nothing, whatever kind the nodes are', () => {
        useDocument.getState().setActiveView('b');
        useDocument.getState().setActiveView('a');
        expect(ended).toEqual([]);
    });

    test('leaves the canvas holding the view it was asked for', () => {
        useDocument.getState().setActiveView('b');
        expect(useCanvas.getState().viewId).toBe('b');
        expect(useCanvas.getState().order).toEqual(['t2']);
        useDocument.getState().setActiveView('a');
        expect(useCanvas.getState().viewId).toBe('a');
        expect(useCanvas.getState().order).toEqual(['t1', 'c1', 'b1']);
    });

    test('never leaves the canvas standing in for a view it does not hold', () => {
        const seen: string[] = [];
        const record = (): void => {
            seen.push(useCanvas.getState().order.join());
        };
        const offCanvas = useCanvas.subscribe(record);
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
        useCanvas.getState().select(['t1', 'c1', 'b1']);
        useCanvas.getState().deleteSelected();
        expect(ended.sort()).toEqual(['browser:b1', 'chat:c1', 'terminal:t1']);
    });

    test('ends a node on a view that is not on screen', () => {
        useDocument.getState().deleteView('b');
        expect(ended).toEqual(['terminal:t2']);
    });

    test('ends nothing when another project swaps in', () => {
        useDocument.getState().load(project([view('x', [node('t9')])]), { activeViewId: 'x', views: {} });
        expect(ended).toEqual([]);
    });
});
