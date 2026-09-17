import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { clientActions, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const document: ProjectDocument = {
    version: 2,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [main, { kind: 'canvas', id: 'release', name: 'Release', nodes: [], texts: [], edges: [], layouts: [] }]
};

beforeEach(() => {
    useDocument.getState().load(document, { activeViewId: 'main', views: {} });
    defaultCanvases.of('main').getState().loadView(main, null);
    defaultCanvases.focus('main');
});

afterEach(() => {
    useDocument.getState().load(null, null);
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('client actions', () => {
    test('the same focus action serves a person and Voice and carries its own undo', async () => {
        expect(await clientActions.execute('view.focus', { viewId: 'release' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { view: 'Release', changed: true }
        });
        const result = await clientActions.execute('view.focus', { viewId: 'main' }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { view: 'Main', changed: true } });
        expect(useDocument.getState().activeViewId).toBe('main');
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        await clientActions.undo(result.undoToken, VOICE_ACTION_CALL);
        expect(useDocument.getState().activeViewId).toBe('release');
    });

    test('rename reports the shared change and restores the previous source on undo', async () => {
        const result = await clientActions.execute('view.rename', { viewId: 'release', name: 'Launch' }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { previousName: 'Release', name: 'Launch', changed: true } });
        expect(useDocument.getState().views[1]).toMatchObject({ name: 'Launch', titleSource: 'user' });
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        await clientActions.undo(result.undoToken, VOICE_ACTION_CALL);
        const restored = useDocument.getState().views[1]!;
        expect(restored).toMatchObject({ name: 'Release' });
        expect('titleSource' in restored ? restored.titleSource : undefined).toBeUndefined();
    });

    test('claiming an unchanged automatic name is still a shared rename', async () => {
        useDocument.getState().renameView('release', 'Release', 'auto');
        const result = await clientActions.execute('view.rename', { viewId: 'release', name: 'Release' }, PERSON_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { changed: true } });
        expect(useDocument.getState().views[1]).toMatchObject({ titleSource: 'user' });
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        await clientActions.undo(result.undoToken, PERSON_ACTION_CALL);
        expect(useDocument.getState().views[1]).toMatchObject({ titleSource: 'auto' });
    });

    test('rename undo refuses to overwrite a newer name', async () => {
        const result = await clientActions.execute('view.rename', { viewId: 'release', name: 'Launch' }, PERSON_ACTION_CALL);
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        useDocument.getState().renameView('release', 'Shipped');
        expect(await clientActions.undo(result.undoToken, PERSON_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'stale-undo' } });
        expect(useDocument.getState().views[1]).toMatchObject({ name: 'Shipped' });
    });

    test('publishes only actions with working client executors', () => {
        expect(clientActions.catalog(VOICE_ACTION_CALL).map((entry) => entry.name)).toEqual([
            'workspace.inspect',
            'view.focus',
            'view.rename',
            'view.create',
            'node.focus',
            'node.rename',
            'node.create',
            'node.duplicate',
            'group.create',
            'canvas.fit',
            'history.undo',
            'history.redo',
            'chat.send'
        ]);
    });

    test('creates a note in free space and safely undoes that exact canvas step', async () => {
        const result = await clientActions.execute(
            'node.create',
            { viewId: 'main', kind: 'note', title: null, content: 'Fleur morgen mijn iPhone laten zien', url: null, command: null },
            VOICE_ACTION_CALL
        );
        expect(result).toMatchObject({
            status: 'completed',
            output: { viewId: 'main', kind: 'note', node: 'Fleur morgen mijn iPhone laten zien' }
        });
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        expect(defaultCanvases.of('main').getState().nodes[result.output.nodeId]).toMatchObject({ body: 'Fleur morgen mijn iPhone laten zien' });
        expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(defaultCanvases.of('main').getState().nodes[result.output.nodeId]).toBeUndefined();
    });

    test('refuses a late canvas undo instead of undoing somebody else’s change', async () => {
        const result = await clientActions.execute(
            'node.create',
            { viewId: 'main', kind: 'note', title: 'First', content: 'First', url: null, command: null },
            VOICE_ACTION_CALL
        );
        if (result.status !== 'completed' || !result.undoToken) {
            return;
        }
        defaultCanvases.of('main').getState().addNode('note', { x: 500, y: 500 }, { title: 'Newer' });
        expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'stale-undo' } });
        expect(Object.values(defaultCanvases.of('main').getState().nodes).map((node) => node.title)).toEqual(['First', 'Newer']);
    });
});
