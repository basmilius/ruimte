import { afterEach, describe, expect, test } from 'bun:test';
import { createCanvasStore, defaultCanvasStore, focusedCanvas } from './canvas';
import { createEditorRegistry } from './editors';
import { createDocumentStore, useDocument } from './document';
import { createDiagramStore } from './diagram';
import { createDrawingStore } from './drawing';
import { createProjectStore, useProject } from './project';
import { currentStores, currentWorkspaceEndpointId, isFocusedWorkspace, resolveEditor, setCurrentWorkspace, type WorkspaceStores } from './workspace-stores';

const workspace = (): WorkspaceStores => {
    const canvases = createEditorRegistry(createCanvasStore);
    const drawings = createEditorRegistry(createDrawingStore);
    const diagrams = createEditorRegistry(createDiagramStore);
    return { canvases, drawings, diagrams, document: createDocumentStore({ canvases, drawings, diagrams }), project: createProjectStore() };
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

describe('which editor a cell resolves to', () => {
    test('the cell it was asked about, even while another cell has the focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('right');

        expect(resolveEditor(registry, 'left')).toBe(registry.peek('left')!);
        expect(resolveEditor(registry, 'right')).toBe(registry.peek('right')!);
    });

    /* The bug this answers: a component drawn in one cell wrote into the cell that had the focus,
       so two drawings side by side edited the same elements. Naming the cell is what settles it. */
    test('two cells resolve to two editors, and neither is the other', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('right');
        resolveEditor(registry, 'left').getState().addText({ x: 0, y: 0 });

        expect(Object.keys(resolveEditor(registry, 'left').getState().texts)).toHaveLength(1);
        expect(Object.keys(resolveEditor(registry, 'right').getState().texts)).toHaveLength(0);
    });

    test('no cell means the one with the focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('left');
        registry.of('right');
        registry.focus('left');
        expect(resolveEditor(registry, null)).toBe(registry.peek('left')!);

        registry.focus('right');
        expect(resolveEditor(registry, null)).toBe(registry.peek('right')!);
    });

    test('a view with no editor of this kind reads the blank one, and so does a grid with no focus', () => {
        const registry = createEditorRegistry(createCanvasStore);
        registry.of('canvas');
        registry.focus('canvas');

        // A chat cell asking for a canvas: there is none, and the blank editor is what it reads.
        expect(resolveEditor(registry, 'chat')).toBe(registry.blank);
        registry.focus(null);
        expect(resolveEditor(registry, null)).toBe(registry.blank);
    });
});

describe('the hook over a slot', () => {
    test('with no workspace and no view open it is the blank editor the module made', () => {
        // Said out loud, because a project left open by another test would resolve to its editor instead.
        useDocument.getState().load(null, null);
        expect(currentStores()).toBeNull();
        focusedCanvas().setState({ viewport: { w: 640, h: 480 } });
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

describe('which workspace a shortcut acts on', () => {
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
