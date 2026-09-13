import { afterEach, describe, expect, test } from 'bun:test';
import { createCanvasStore, defaultCanvasStore, useCanvas } from './canvas';
import { createEditorRegistry } from './editors';
import { createDocumentStore, useDocument } from './document';
import { createDrawingStore } from './drawing';
import { createProjectStore, useProject } from './project';
import { currentStores, currentWorkspaceEndpointId, isFocusedWorkspace, setCurrentWorkspace, type WorkspaceStores } from './workspace-stores';

const workspace = (): WorkspaceStores => {
    const canvases = createEditorRegistry(createCanvasStore);
    const drawings = createEditorRegistry(createDrawingStore);
    return { canvases, drawings, document: createDocumentStore({ canvases, drawings }), project: createProjectStore() };
};

/* The canvas a workspace is editing: with no view loaded that is its blank editor. */
const canvasOf = (stores: WorkspaceStores): ReturnType<typeof createCanvasStore> => {
    const active = stores.document.getState().activeViewId;
    return (active === null ? null : stores.canvases.peek(active)) ?? stores.canvases.blank;
};

afterEach(() => {
    setCurrentWorkspace(null);
});

describe('the stores of a workspace', () => {
    test('two workspaces edit two canvases', () => {
        const here = workspace();
        const there = workspace();
        canvasOf(here)
            .getState()
            .updateText(canvasOf(here).getState().addText({ x: 0, y: 0 }), 'here');
        canvasOf(there)
            .getState()
            .updateText(canvasOf(there).getState().addText({ x: 0, y: 0 }), 'there');

        expect(Object.values(canvasOf(here).getState().texts).map((element) => element.text)).toEqual(['here']);
        expect(Object.values(canvasOf(there).getState().texts).map((element) => element.text)).toEqual(['there']);
    });

    test('a view added in one workspace lands in its own canvas', () => {
        const here = workspace();
        const there = workspace();
        here.document.getState().load({ version: 2, rev: 1, name: 'Here', color: '#000', views: [] }, null);
        here.document.getState().addCanvasView('Drafts');

        expect(here.canvases.live()).toHaveLength(1);
        expect(canvasOf(here).getState().viewId).not.toBeNull();
        expect(there.canvases.live()).toHaveLength(0);
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
    test('with no workspace and no view open it is the blank editor the module made', () => {
        // Said out loud, because a project left open by another test would resolve to its editor instead.
        useDocument.getState().load(null, null);
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

describe('which workspace a chord acts on', () => {
    test('the one that has the focus, never the one beside it', () => {
        const here = workspace();
        const there = workspace();
        setCurrentWorkspace({ stores: here, endpointId: 'local' });

        expect(isFocusedWorkspace(here)).toBe(true);
        expect(isFocusedWorkspace(there)).toBe(false);
    });

    test('outside every workspace there is one project and it is this one', () => {
        setCurrentWorkspace({ stores: workspace(), endpointId: 'local' });

        expect(isFocusedWorkspace(null)).toBe(true);
    });

    test('before the first workspace is built nothing is blocked', () => {
        expect(isFocusedWorkspace(workspace())).toBe(true);
    });
});
