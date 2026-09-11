import { afterEach, describe, expect, test } from 'bun:test';
import { createCanvasStore, defaultCanvasStore, useCanvas } from './canvas';
import { createDocumentStore } from './document';
import { createDrawingStore } from './drawing';
import { createProjectStore, useProject } from './project';
import { currentStores, currentWorkspaceEndpointId, setCurrentWorkspace, type WorkspaceStores } from './workspace-stores';

const workspace = (): WorkspaceStores => {
    const canvas = createCanvasStore();
    const drawing = createDrawingStore();
    return { canvas, drawing, document: createDocumentStore({ canvas, drawing }), project: createProjectStore() };
};

afterEach(() => {
    setCurrentWorkspace(null);
});

describe('the stores of a workspace', () => {
    test('two workspaces edit two canvases', () => {
        const here = workspace();
        const there = workspace();
        here.canvas.getState().updateText(here.canvas.getState().addText({ x: 0, y: 0 }), 'here');
        there.canvas.getState().updateText(there.canvas.getState().addText({ x: 0, y: 0 }), 'there');

        expect(Object.values(here.canvas.getState().texts).map((element) => element.text)).toEqual(['here']);
        expect(Object.values(there.canvas.getState().texts).map((element) => element.text)).toEqual(['there']);
    });

    test('a view added in one workspace lands in its own canvas', () => {
        const here = workspace();
        const there = workspace();
        here.document.getState().load({ version: 2, rev: 1, name: 'Here', color: '#000', views: [] }, null);
        here.document.getState().addCanvasView('Drafts');

        expect(here.canvas.getState().viewId).not.toBeNull();
        expect(there.canvas.getState().viewId).toBeNull();
    });

    test('the open project of one workspace says nothing about the other', () => {
        const here = workspace();
        const there = workspace();
        here.project.getState().setDirty(true);

        expect(here.project.getState().dirty).toBe(true);
        expect(there.project.getState().dirty).toBe(false);
    });
});

describe('the hook over a slot', () => {
    test('with no workspace it is the store the module made', () => {
        expect(currentStores()).toBeNull();
        useCanvas.setState({ viewport: { w: 640, h: 480 } });
        expect(defaultCanvasStore.getState().viewport).toEqual({ w: 640, h: 480 });
    });

    test('it reads and writes the workspace that has the focus', () => {
        const here = workspace();
        setCurrentWorkspace({ stores: here, endpointId: 'daemon-a' });
        useProject.getState().setError('nothing saved');

        expect(here.project.getState().error).toBe('nothing saved');
        expect(useProject.getState().error).toBe('nothing saved');
    });

    test('the focused workspace says which machine the code outside React is about', () => {
        expect(currentWorkspaceEndpointId()).toBeNull();
        setCurrentWorkspace({ stores: workspace(), endpointId: 'daemon-b' });
        expect(currentWorkspaceEndpointId()).toBe('daemon-b');
    });

    test('the focus moving takes every reader with it', () => {
        const here = workspace();
        const there = workspace();
        setCurrentWorkspace({ stores: here, endpointId: 'daemon-a' });
        useProject.getState().setError('on this machine');
        setCurrentWorkspace({ stores: there, endpointId: 'daemon-b' });

        expect(useProject.getState().error).toBeNull();
        expect(here.project.getState().error).toBe('on this machine');
    });

    test('a listener follows the store it was added to, not the one that comes after', () => {
        const here = workspace();
        setCurrentWorkspace({ stores: here, endpointId: 'daemon-a' });
        const seen: Array<string | null> = [];
        const off = useProject.subscribe((state) => seen.push(state.error));
        useProject.getState().setError('first');
        setCurrentWorkspace({ stores: workspace(), endpointId: 'daemon-b' });
        useProject.getState().setError('second');
        off();

        expect(seen).toEqual(['first']);
    });
});
