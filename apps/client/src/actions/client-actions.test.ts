import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { clientActions, createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { defaultCanvases } from '@/state/canvas';
import { defaultDiagrams } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { defaultDrawings } from '@/state/drawing';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const document: ProjectDocument = {
    version: 3,
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
    test('clearing asks before deleting the conversation and keeps the chat view', async () => {
        const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} })!;
        const cleared: string[] = [];
        const registry = createClientActionRegistry(useDocument, async (id) => {
            cleared.push(id);
        });
        const requested = await registry.execute('chat.clear', { chatId }, VOICE_ACTION_CALL);
        expect(requested.status).toBe('needs_confirmation');
        expect(cleared).toEqual([]);
        if (requested.status !== 'needs_confirmation') {
            return;
        }
        expect(requested.confirmation.consequences.join(' ')).toContain('current turn');
        const result = await registry.confirm(requested.confirmationToken, true, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { chatId, chat: 'Research' } });
        expect(cleared).toEqual([chatId]);
        expect(useDocument.getState().views.some((view) => view.id === chatId)).toBe(true);
        expect('undoToken' in result).toBe(false);
    });

    test('cancelling a clear leaves the conversation untouched', async () => {
        const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} })!;
        let cleared = false;
        const registry = createClientActionRegistry(useDocument, async () => {
            cleared = true;
        });
        const result = await registry.execute('chat.clear', { chatId }, VOICE_ACTION_CALL);
        if (result.status !== 'needs_confirmation') {
            throw new Error('Expected confirmation');
        }
        expect((await registry.confirm(result.confirmationToken, false, VOICE_ACTION_CALL)).status).toBe('failed');
        expect(cleared).toBe(false);
    });

    test('a missing chat or a daemon failure never reports a successful clear', async () => {
        const registry = createClientActionRegistry(useDocument, async () => {
            throw new Error('offline');
        });
        expect((await registry.execute('chat.clear', { chatId: 'missing' }, VOICE_ACTION_CALL)).status).toBe('failed');
        const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} })!;
        const result = await registry.execute('chat.clear', { chatId }, VOICE_ACTION_CALL);
        if (result.status !== 'needs_confirmation') {
            throw new Error('Expected confirmation');
        }
        expect((await registry.confirm(result.confirmationToken, true, VOICE_ACTION_CALL)).status).toBe('failed');
    });

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
            'agents.inspect',
            'agent.activity',
            'projects.list-open',
            'project.switch',
            'workspace.inspect',
            'view.focus',
            'view.rename',
            'view.create',
            'view.delete',
            'node.focus',
            'node.rename',
            'node.create',
            'node.duplicate',
            'canvas.select',
            'node.delete',
            'group.create',
            'canvas.fit',
            'history.undo',
            'history.redo',
            'chat.send',
            'chat.clear',
            'chat.read'
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

    test('names a new view the way the view menu always has, and an explicit name still wins', async () => {
        const create = async (kind: 'canvas' | 'drawing' | 'diagram' | 'terminal', name: string | null = null) => {
            const result = await clientActions.execute('view.create', { kind, name, url: null, command: null }, PERSON_ACTION_CALL);
            return result.status === 'completed' ? result.output.view : null;
        };
        expect(await create('canvas')).toBe('Canvas');
        expect(await create('canvas')).toBe('Canvas 2');
        expect(await create('drawing')).toBe('Drawing');
        expect(await create('diagram')).toBe('Diagram');
        expect(await create('terminal')).toBe('Terminal');
        expect(await create('terminal')).toBe('Terminal 2');
        expect(await create('canvas', 'Launch')).toBe('Launch');
    });

    test('undoes and redoes a drawing on screen, and says when there was nothing to redo', async () => {
        const viewId = useDocument.getState().addDrawingView('Sketch')!;
        useDocument.getState().showView(viewId);
        const drawing = defaultDrawings.of(viewId);
        drawing
            .getState()
            .load(
                viewId,
                { version: 1, rev: 1, elements: [{ kind: 'rect', id: 'a', x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }] },
                null
            );
        defaultDrawings.focus(viewId);
        drawing.getState().select(['a']);
        drawing.getState().deleteSelected();
        expect(await clientActions.execute('history.undo', { viewId }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { view: 'Sketch', changed: true }
        });
        expect(drawing.getState().elements.map((element) => element.id)).toEqual(['a']);
        expect(await clientActions.execute('history.redo', { viewId }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed', output: { changed: true } });
        expect(drawing.getState().elements).toEqual([]);
        expect(await clientActions.execute('history.redo', { viewId }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed', output: { changed: false } });
        defaultDrawings.release(viewId);
    });

    test('undoes a diagram on screen and refuses one that is not', async () => {
        const viewId = useDocument.getState().addDiagramView('Flow')!;
        useDocument.getState().showView(viewId);
        const diagram = defaultDiagrams.of(viewId);
        diagram
            .getState()
            .load(viewId, { version: 1, rev: 1, meta: { title: '', direction: 'right' }, nodes: [{ id: 'a', label: 'Client' }], groups: [], edges: [] }, null);
        defaultDiagrams.focus(viewId);
        diagram.getState().renameNode('a', 'Browser');
        expect(await clientActions.execute('history.undo', { viewId: 'main' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'inactive-view' }
        });
        expect(await clientActions.execute('history.undo', { viewId }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed', output: { changed: true } });
        expect(diagram.getState().content.nodes[0]).toMatchObject({ label: 'Client' });
        defaultDiagrams.release(viewId);
    });
});
