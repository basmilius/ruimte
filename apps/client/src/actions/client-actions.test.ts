import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ActionInput, ActionRegistry } from '@ruimte/actions';
import type { ProjectCanvasView, ProjectDocument, ProviderInfo } from '@ruimte/contracts';
import { clientActions, createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { defaultCanvases } from '@/state/canvas';
import { defaultDiagrams } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { defaultDrawings } from '@/state/drawing';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const claude = { kind: 'claude', name: 'Claude Code', installed: true, capabilities: { chat: true, terminal: true } } as unknown as ProviderInfo;
const codex = { kind: 'codex', name: 'Codex', installed: false, capabilities: { chat: true, terminal: true } } as unknown as ProviderInfo;

const createView = (registry: ActionRegistry<void>, input: Partial<ActionInput<'view.create'>> & Pick<ActionInput<'view.create'>, 'kind'>) =>
    registry.execute('view.create', { name: null, url: null, command: null, path: null, provider: null, ...input }, PERSON_ACTION_CALL);

const createNode = (registry: ActionRegistry<void>, input: Partial<ActionInput<'node.create'>> & Pick<ActionInput<'node.create'>, 'kind'>) =>
    registry.execute(
        'node.create',
        { viewId: 'main', title: null, content: null, url: null, command: null, path: null, provider: null, at: null, ...input },
        VOICE_ACTION_CALL
    );

const canvas = () => defaultCanvases.of('main').getState();

/* Asks, answers yes, and hands back what the action did. */
const confirmed = async (registry: ActionRegistry<void>, asked: Awaited<ReturnType<ActionRegistry<void>['execute']>>) => {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${asked.status}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
};

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
        const registry = createClientActionRegistry(useDocument, {
            clearChat: async (id) => {
                cleared.push(id);
            }
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
        const registry = createClientActionRegistry(useDocument, {
            clearChat: async () => {
                cleared = true;
            }
        });
        const result = await registry.execute('chat.clear', { chatId }, VOICE_ACTION_CALL);
        if (result.status !== 'needs_confirmation') {
            throw new Error('Expected confirmation');
        }
        expect((await registry.confirm(result.confirmationToken, false, VOICE_ACTION_CALL)).status).toBe('failed');
        expect(cleared).toBe(false);
    });

    test('a missing chat or a daemon failure never reports a successful clear', async () => {
        const registry = createClientActionRegistry(useDocument, {
            clearChat: async () => {
                throw new Error('offline');
            }
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

    test('publishes only actions with working client executors, and sharing to a person alone', () => {
        expect(clientActions.catalog(PERSON_ACTION_CALL).map((entry) => entry.name)).toContain('view.share');
        expect(clientActions.catalog(VOICE_ACTION_CALL).map((entry) => entry.name)).toEqual([
            'agents.inspect',
            'agent.activity',
            'projects.list-open',
            'project.switch',
            'workspace.inspect',
            'target.resolve',
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
            'canvasText.create',
            'node.promoteToView',
            'node.moveToView',
            'view.duplicate',
            'view.placeOnCanvas',
            'view.showOnCanvas',
            'layout.save',
            'layout.apply',
            'layout.delete',
            'canvas.setLocks',
            'split.create',
            'split.close',
            'split.focus',
            'terminal.clear',
            'chat.send',
            'chat.clear',
            'chat.read'
        ]);
    });

    test('creates a note in free space and safely undoes that exact canvas step', async () => {
        const result = await clientActions.execute(
            'node.create',
            {
                viewId: 'main',
                kind: 'note',
                title: null,
                content: 'Fleur morgen mijn iPhone laten zien',
                url: null,
                command: null,
                path: null,
                provider: null,
                at: null
            },
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
            { viewId: 'main', kind: 'note', title: 'First', content: 'First', url: null, command: null, path: null, provider: null, at: null },
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
            const result = await clientActions.execute('view.create', { kind, name, url: null, command: null, path: null, provider: null }, PERSON_ACTION_CALL);
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

    test('fits a drawing on screen, not the canvas behind it', async () => {
        const viewId = useDocument.getState().addDrawingView('Sketch')!;
        useDocument.getState().showView(viewId);
        const drawing = defaultDrawings.of(viewId);
        drawing
            .getState()
            .load(
                viewId,
                { version: 1, rev: 1, elements: [{ kind: 'rect', id: 'a', x: 2000, y: 1500, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }] },
                null
            );
        defaultDrawings.focus(viewId);
        drawing.getState().setViewport({ w: 1000, h: 800 });
        drawing.getState().setCamera({ x: 0, y: 0, zoom: 1 });
        const canvasCamera = defaultCanvases.of('main').getState().camera;
        expect(await clientActions.execute('canvas.fit', { viewId }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed', output: { view: 'Sketch' } });
        expect(drawing.getState().camera).not.toEqual({ x: 0, y: 0, zoom: 1 });
        expect(defaultCanvases.of('main').getState().camera).toEqual(canvasCamera);
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

    describe('making views', () => {
        const registry = () => createClientActionRegistry(useDocument, { providers: () => [claude, codex] });

        test('a separator and a subheader go in the list without opening, and a file view opens on its path', async () => {
            expect(await createView(registry(), { kind: 'separator' })).toMatchObject({ status: 'completed', output: { kind: 'separator' } });
            expect(await createView(registry(), { kind: 'subheader' })).toMatchObject({ status: 'completed', output: { view: 'Section', kind: 'subheader' } });
            expect(useDocument.getState().activeViewId).toBe('main');
            const file = await createView(registry(), { kind: 'file', path: 'docs/notes.md' });
            if (file.status !== 'completed') {
                throw new Error('Expected a file view');
            }
            expect(file.output.view).toBe('notes.md');
            expect(useDocument.getState().views.find((view) => view.id === file.output.viewId)).toMatchObject({ kind: 'file', path: 'docs/notes.md' });
            expect(useDocument.getState().activeViewId).toBe(file.output.viewId);
            expect(await createView(registry(), { kind: 'file' })).toMatchObject({ status: 'failed', error: { code: 'missing-path' } });
        });

        test('an agent view runs the CLI it names, and only one this machine has', async () => {
            const chat = await createView(registry(), { kind: 'chat', provider: 'claude' });
            if (chat.status !== 'completed') {
                throw new Error('Expected an agent view');
            }
            expect(useDocument.getState().views.find((view) => view.id === chat.output.viewId)).toMatchObject({
                kind: 'chat',
                name: 'Claude Code',
                node: { provider: 'claude', providerFixed: true }
            });
            expect(await createView(registry(), { kind: 'terminal', provider: 'codex' })).toMatchObject({ error: { code: 'unknown-provider' } });
            expect(await createView(registry(), { kind: 'canvas', provider: 'claude' })).toMatchObject({ error: { code: 'invalid-provider' } });
            expect(await createView(registry(), { kind: 'terminal', provider: 'claude', command: 'ls' })).toMatchObject({
                error: { code: 'invalid-provider' }
            });
        });

        test('a duplicate lands under its source unopened, and undo takes back only a copy nobody opened', async () => {
            const copied: string[] = [];
            const drawings = createClientActionRegistry(useDocument, { copyViewContent: (kind, from, to) => void copied.push(`${kind}:${from}:${to}`) });
            const result = await drawings.execute('view.duplicate', { viewId: 'release' }, VOICE_ACTION_CALL);
            if (result.status !== 'completed' || !result.undoToken) {
                throw new Error('Expected a copy');
            }
            expect(result.output).toMatchObject({ sourceViewId: 'release', view: 'Release copy', kind: 'canvas' });
            expect(useDocument.getState().views.map((view) => view.id)).toEqual(['main', 'release', result.output.viewId]);
            expect(useDocument.getState().activeViewId).toBe('main');
            expect(await drawings.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(useDocument.getState().views.map((view) => view.id)).toEqual(['main', 'release']);

            const sketch = useDocument.getState().addDrawingView('Sketch');
            const again = await drawings.execute('view.duplicate', { viewId: sketch }, VOICE_ACTION_CALL);
            if (again.status !== 'completed' || !again.undoToken) {
                throw new Error('Expected a copy');
            }
            expect(copied).toEqual([`drawing:${sketch}:${again.output.viewId}`]);
            useDocument.getState().setActiveView(again.output.viewId);
            expect(await drawings.undo(again.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'stale-undo' } });
            expect(useDocument.getState().views.some((view) => view.id === again.output.viewId)).toBe(true);
            const terminal = useDocument.getState().addStandaloneView({ kind: 'terminal', name: 'Shell', node: {} });
            expect(await drawings.execute('view.duplicate', { viewId: terminal }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'view-not-duplicable' } });
        });

        test('a view goes onto the canvas as the node it was and comes back out on undo', async () => {
            const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} });
            const result = await clientActions.execute('view.placeOnCanvas', { viewId: chatId }, VOICE_ACTION_CALL);
            if (result.status !== 'completed' || !result.undoToken) {
                throw new Error('Expected a placed view');
            }
            expect(result.output).toMatchObject({ view: 'Research', canvasViewId: 'main', canvas: 'Main' });
            expect(canvas().nodes[chatId]).toMatchObject({ kind: 'chat', title: 'Research' });
            expect(useDocument.getState().views.some((view) => view.id === chatId)).toBe(false);
            expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(useDocument.getState().views.find((view) => view.id === chatId)).toMatchObject({ kind: 'chat' });
            expect(await clientActions.execute('view.placeOnCanvas', { viewId: 'release' }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'view-not-placeable' }
            });
        });

        test('a diagram is mirrored on the canvas it goes to, and the mirror goes on undo', async () => {
            const flow = useDocument.getState().addDiagramView('Flow');
            expect(useDocument.getState().activeViewId).toBe(flow);
            const result = await clientActions.execute('view.showOnCanvas', { viewId: flow }, VOICE_ACTION_CALL);
            if (result.status !== 'completed' || !result.undoToken) {
                throw new Error('Expected a mirror');
            }
            expect(useDocument.getState().activeViewId).toBe('main');
            expect(canvas().nodes[result.output.nodeId]).toMatchObject({ kind: 'diagram', viewId: flow, title: 'Flow' });
            expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(canvas().nodes[result.output.nodeId]).toBeUndefined();
            expect(useDocument.getState().views.some((view) => view.id === flow)).toBe(true);
        });

        test('only a person moves a view into the shared file, and the way back refuses once it moved again', async () => {
            expect(await clientActions.execute('view.share', { viewId: 'release', shared: true }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'forbidden-action' }
            });
            expect(useDocument.getState().shared).toEqual([]);
            const result = await clientActions.execute('view.share', { viewId: 'release', shared: true }, PERSON_ACTION_CALL);
            if (result.status !== 'completed' || !result.undoToken) {
                throw new Error('Expected a shared view');
            }
            expect(result.output).toEqual({ viewId: 'release', view: 'Release', shared: true, changed: true });
            expect(useDocument.getState().shared).toEqual(['release']);
            expect(await clientActions.undo(result.undoToken, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(useDocument.getState().shared).toEqual([]);
            const separator = useDocument.getState().addSeparatorView();
            expect(await clientActions.execute('view.share', { viewId: separator, shared: true }, PERSON_ACTION_CALL)).toMatchObject({
                error: { code: 'view-not-shareable' }
            });
        });
    });

    describe('making nodes', () => {
        const registry = () => createClientActionRegistry(useDocument, { providers: () => [claude, codex] });

        test('a node lands where it was asked, an agent carries its CLI and a file its path', async () => {
            const agent = await createNode(registry(), { kind: 'terminal', provider: 'claude', at: { x: 480, y: 320 } });
            if (agent.status !== 'completed') {
                throw new Error('Expected an agent terminal');
            }
            const node = canvas().nodes[agent.output.nodeId]!;
            expect(node).toMatchObject({ title: 'Claude Code', provider: 'claude' });
            expect(node.runtimeMode).toBeDefined();
            expect(Math.abs(node.x + node.w / 2 - 480)).toBeLessThanOrEqual(16);
            expect(Math.abs(node.y + node.h / 2 - 320)).toBeLessThanOrEqual(16);

            const file = await createNode(registry(), { kind: 'file', path: 'src/main.ts' });
            if (file.status !== 'completed') {
                throw new Error('Expected a file node');
            }
            expect(canvas().nodes[file.output.nodeId]).toMatchObject({ kind: 'file', title: 'main.ts', path: 'src/main.ts' });
            expect(await createNode(registry(), { kind: 'file' })).toMatchObject({ error: { code: 'missing-path' } });
            expect(await createNode(registry(), { kind: 'note', provider: 'claude' })).toMatchObject({ error: { code: 'invalid-provider' } });
        });

        test('text is written where it was asked and goes again on undo', async () => {
            const result = await clientActions.execute('canvasText.create', { viewId: 'main', text: 'Launch', at: { x: 96, y: 64 } }, VOICE_ACTION_CALL);
            if (result.status !== 'completed' || !result.undoToken) {
                throw new Error('Expected text');
            }
            expect(canvas().texts[result.output.textId]).toMatchObject({ text: 'Launch', x: 96, y: 64 });
            expect(canvas().editingTextId).toBeNull();
            expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(canvas().texts[result.output.textId]).toBeUndefined();
        });

        test('an empty text opens for typing, the way a double-click starts one', async () => {
            const result = await clientActions.execute('canvasText.create', { viewId: 'main', text: null, at: null }, PERSON_ACTION_CALL);
            if (result.status !== 'completed') {
                throw new Error('Expected text');
            }
            expect(canvas().editingTextId).toBe(result.output.textId);
        });
    });

    describe('moving nodes between views', () => {
        const withLine = (): void => {
            const shell = canvas().addNode('terminal', { x: 0, y: 0 }, { title: 'Shell' })!;
            const notes = canvas().addNode('note', { x: 800, y: 0 }, { title: 'Notes' })!;
            canvas().addEdge(notes, shell);
        };
        const shellId = (): string => Object.values(canvas().nodes).find((node) => node.title === 'Shell')!.id;

        test('a node with lines asks Voice before it leaves them behind as a view', async () => {
            withLine();
            const nodeId = shellId();
            const asked = await clientActions.execute('node.promoteToView', { viewId: 'main', nodeId }, VOICE_ACTION_CALL);
            expect(asked).toMatchObject({ status: 'needs_confirmation', confirmation: { consequences: ['1 line drawn to it will be removed.'] } });
            expect(canvas().nodes[nodeId]).toBeDefined();
            const result = await confirmed(clientActions, asked);
            expect(result).toMatchObject({ status: 'completed', output: { view: 'Shell', kind: 'terminal' } });
            expect(useDocument.getState().views.find((view) => view.id === nodeId)).toMatchObject({ kind: 'terminal', name: 'Shell' });
            if (result.status !== 'completed' || !result.undoToken) {
                return;
            }
            expect(await clientActions.undo(result.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(useDocument.getState().views.some((view) => view.id === nodeId)).toBe(false);
        });

        test('a note stays a node', async () => {
            const noteId = canvas().addNode('note', { x: 0, y: 0 })!;
            expect(await clientActions.execute('node.promoteToView', { viewId: 'main', nodeId: noteId }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'node-not-promotable' }
            });
        });

        test('a node moves to another canvas after Voice hears about its lines, and a group or the same canvas is refused', async () => {
            withLine();
            const nodeId = shellId();
            const moved = await confirmed(
                clientActions,
                await clientActions.execute('node.moveToView', { viewId: 'main', nodeId, targetViewId: 'release' }, VOICE_ACTION_CALL)
            );
            expect(moved).toMatchObject({ status: 'completed', output: { node: 'Shell', target: 'Release' } });
            expect(canvas().nodes[nodeId]).toBeUndefined();
            const release = useDocument.getState().views.find((view) => view.id === 'release');
            expect(release?.kind === 'canvas' && release.nodes.some((node) => node.id === nodeId)).toBe(true);
            const notes = Object.values(canvas().nodes).find((node) => node.title === 'Notes')!.id;
            expect(await clientActions.execute('node.moveToView', { viewId: 'main', nodeId: notes, targetViewId: 'main' }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'same-view' }
            });
            const group = canvas().addNode('group', { x: 2000, y: 0 })!;
            expect(await clientActions.execute('node.moveToView', { viewId: 'main', nodeId: group, targetViewId: 'release' }, VOICE_ACTION_CALL)).toMatchObject(
                {
                    error: { code: 'node-not-movable' }
                }
            );
        });
    });

    describe('layouts and locks', () => {
        const shift = (nodeId: string): void => {
            canvas().select([nodeId]);
            canvas().moveSelected(160, 0, true);
            canvas().settleMove();
        };

        test('a saved layout brings nodes back, and undo puts them where they were moved', async () => {
            const nodeId = canvas().addNode('note', { x: 0, y: 0 })!;
            const home = canvas().nodes[nodeId]!.x;
            expect(await clientActions.execute('layout.save', { viewId: 'main', name: 'Home' }, VOICE_ACTION_CALL)).toMatchObject({
                status: 'completed',
                output: { replaced: false }
            });
            shift(nodeId);
            const applied = await clientActions.execute('layout.apply', { viewId: 'main', name: 'Home' }, VOICE_ACTION_CALL);
            expect(canvas().nodes[nodeId]!.x).toBe(home);
            if (applied.status !== 'completed' || !applied.undoToken) {
                throw new Error('Expected an applied layout');
            }
            expect(await clientActions.undo(applied.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(canvas().nodes[nodeId]!.x).toBe(home + 160);
            expect(await clientActions.execute('layout.apply', { viewId: 'main', name: 'Away' }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'unknown-layout' }
            });
        });

        test('saving over a layout asks Voice first, and undo brings the old one back', async () => {
            const nodeId = canvas().addNode('note', { x: 0, y: 0 })!;
            canvas().saveLayout('Home');
            const before = canvas().layouts[0];
            shift(nodeId);
            const replaced = await confirmed(clientActions, await clientActions.execute('layout.save', { viewId: 'main', name: 'Home' }, VOICE_ACTION_CALL));
            expect(replaced).toMatchObject({ status: 'completed', output: { replaced: true } });
            expect(canvas().layouts[0]).not.toEqual(before);
            if (replaced.status !== 'completed' || !replaced.undoToken) {
                return;
            }
            expect(await clientActions.undo(replaced.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(canvas().layouts).toEqual([before!]);
        });

        test('deleting a layout asks Voice first and undo restores it, unless one of that name came back', async () => {
            canvas().saveLayout('Home');
            const saved = canvas().layouts[0]!;
            const asked = await clientActions.execute('layout.delete', { viewId: 'main', name: 'Home' }, VOICE_ACTION_CALL);
            expect(canvas().layouts).toHaveLength(1);
            const deleted = await confirmed(clientActions, asked);
            expect(canvas().layouts).toEqual([]);
            if (deleted.status !== 'completed' || !deleted.undoToken) {
                throw new Error('Expected a deleted layout');
            }
            expect(await clientActions.undo(deleted.undoToken, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
            expect(canvas().layouts).toEqual([saved]);
        });

        test('locks one gesture or all four', async () => {
            expect(await clientActions.execute('canvas.setLocks', { viewId: 'main', locked: true, gestures: ['move'] }, VOICE_ACTION_CALL)).toMatchObject({
                output: { locks: { pan: false, zoom: false, move: true, resize: false } }
            });
            await clientActions.execute('canvas.setLocks', { viewId: 'main', locked: true, gestures: null }, VOICE_ACTION_CALL);
            expect(canvas().locks).toEqual({ pan: true, zoom: true, move: true, resize: true });
            await clientActions.execute('canvas.setLocks', { viewId: 'main', locked: false, gestures: null }, PERSON_ACTION_CALL);
            expect(canvas().locks).toEqual({ pan: false, zoom: false, move: false, resize: false });
        });
    });

    describe('the grid', () => {
        test('splits with the view that is not on screen yet, moves the focus and closes down to one cell', async () => {
            expect(await clientActions.execute('split.create', { direction: 'right', viewId: null }, VOICE_ACTION_CALL)).toMatchObject({
                status: 'completed',
                output: { viewId: 'release', view: 'Release', direction: 'right' }
            });
            expect(await clientActions.execute('split.create', { direction: 'down', viewId: null }, VOICE_ACTION_CALL)).toMatchObject({
                error: { code: 'no-free-view' }
            });
            expect(await clientActions.execute('split.focus', { direction: 'left' }, VOICE_ACTION_CALL)).toMatchObject({
                output: { viewId: 'main', changed: true }
            });
            expect(await clientActions.execute('split.focus', { direction: 'left' }, VOICE_ACTION_CALL)).toMatchObject({
                output: { viewId: 'main', changed: false }
            });
            expect(await clientActions.execute('split.close', { viewId: 'release' }, VOICE_ACTION_CALL)).toMatchObject({
                output: { viewId: 'release', view: 'Release' }
            });
            expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(true);
            expect(await clientActions.execute('split.close', { viewId: null }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'last-cell' } });
        });
    });

    describe('clearing a terminal', () => {
        test('asks Voice before the scrollback goes, and never lets an agent clear it', async () => {
            const cleared: string[] = [];
            const registry = createClientActionRegistry(useDocument, { clearTerminal: (id) => void cleared.push(id) });
            const terminalId = canvas().addNode('terminal', { x: 0, y: 0 }, { title: 'Shell' })!;
            expect(await registry.execute('terminal.clear', { terminalId }, { actor: { kind: 'agent', id: 'agent-1' }, context: undefined })).toMatchObject({
                error: { code: 'forbidden-action' }
            });
            const asked = await registry.execute('terminal.clear', { terminalId }, VOICE_ACTION_CALL);
            expect(asked).toMatchObject({ status: 'needs_confirmation', confirmation: { title: 'Clear terminal “Shell”?' } });
            expect(cleared).toEqual([]);
            expect(await confirmed(registry, asked)).toMatchObject({ status: 'completed', output: { terminal: 'Shell' } });
            expect(cleared).toEqual([terminalId]);
            expect(await registry.execute('terminal.clear', { terminalId: 'gone' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'unknown-terminal' } });
        });
    });

    describe('deleting nodes', () => {
        const board: ProjectCanvasView = {
            ...main,
            nodes: [
                { id: 'notes', kind: 'file', title: 'notes.md', path: 'docs/notes.md', x: 0, y: 0, w: 400, h: 300 },
                { id: 'research', kind: 'chat', title: 'Research', x: 500, y: 0, w: 400, h: 300 }
            ]
        };
        const crew: ProjectCanvasView = {
            kind: 'canvas',
            id: 'crew',
            name: 'Crew',
            nodes: [{ id: 'helper', kind: 'chat', title: 'Helper', x: 0, y: 0, w: 400, h: 300 }],
            texts: [],
            edges: [],
            layouts: []
        };

        const machineWith = (saves: boolean) => {
            const unsaved = new Set(['/repo/docs/notes.md']);
            const saved: string[] = [];
            const registry = createClientActionRegistry(useDocument, {
                viewDeletion: {
                    folder: () => '/repo',
                    isUnsaved: (path) => unsaved.has(path),
                    save: async (path) => {
                        saved.push(path);
                        if (saves) {
                            unsaved.delete(path);
                        }
                        return saves;
                    },
                    working: (node) => node.id === 'research',
                    endedBy: async (nodeIds) => (nodeIds.includes('research') ? ['helper', 'gone'] : [])
                }
            });
            return { registry, saved };
        };

        beforeEach(() => {
            useDocument.getState().load({ ...document, views: [board, crew] }, { activeViewId: 'main', views: {} });
            canvas().loadView(board, null);
            defaultCanvases.focus('main');
        });

        test('names the files it saves and the agents it ends, and saves before it deletes', async () => {
            const { registry, saved } = machineWith(true);
            const asked = await registry.execute('node.delete', { viewId: 'main', nodeIds: ['notes', 'research'] }, VOICE_ACTION_CALL);
            expect(asked).toMatchObject({
                status: 'needs_confirmation',
                confirmation: {
                    title: 'Delete 2 nodes?',
                    consequences: [
                        'The nodes and their connections will be removed.',
                        '1 chat or terminal session may be ended.',
                        'Unsaved changes to “notes.md” will be saved first.',
                        '“Research” is still working and will be stopped.',
                        '“Helper” and an agent were started from these nodes and will end too.'
                    ]
                }
            });
            expect(saved).toEqual([]);
            expect(await confirmed(registry, asked)).toMatchObject({ status: 'completed', output: { nodes: ['notes.md', 'Research'] } });
            expect(saved).toEqual(['/repo/docs/notes.md']);
            expect(canvas().order).toEqual([]);
        });

        test('keeps the nodes when a file among them does not save', async () => {
            const { registry } = machineWith(false);
            const asked = await registry.execute('node.delete', { viewId: 'main', nodeIds: ['notes'] }, VOICE_ACTION_CALL);
            expect(await confirmed(registry, asked)).toMatchObject({ status: 'failed', error: { code: 'unsaved-files' } });
            expect(canvas().nodes.notes).toBeDefined();
        });
    });

    describe('deleting a view', () => {
        const board: ProjectCanvasView = {
            kind: 'canvas',
            id: 'board',
            name: 'Board',
            nodes: [
                { id: 'notes', kind: 'file', title: 'notes.md', path: 'docs/notes.md', x: 0, y: 0, w: 400, h: 300 },
                { id: 'research', kind: 'chat', title: 'Research', x: 500, y: 0, w: 400, h: 300 },
                { id: 'shell', kind: 'terminal', title: 'Shell', x: 1000, y: 0, w: 400, h: 300 }
            ],
            texts: [],
            edges: [],
            layouts: []
        };
        const crew: ProjectCanvasView = {
            kind: 'canvas',
            id: 'crew',
            name: 'Crew',
            nodes: [{ id: 'helper', kind: 'chat', title: 'Helper', x: 0, y: 0, w: 400, h: 300 }],
            texts: [],
            edges: [],
            layouts: []
        };

        /* A machine where the notes have unsaved changes, Research is in a turn and opened Helper. */
        const machineWith = (saves: boolean) => {
            const unsaved = new Set(['/repo/docs/notes.md']);
            const saved: string[] = [];
            const registry = createClientActionRegistry(useDocument, {
                viewDeletion: {
                    folder: () => '/repo',
                    isUnsaved: (path) => unsaved.has(path),
                    save: async (path) => {
                        saved.push(path);
                        if (saves) {
                            unsaved.delete(path);
                        }
                        return saves;
                    },
                    working: (node) => node.id === 'research',
                    endedBy: async (nodeIds) => (nodeIds.includes('research') ? ['helper', 'gone'] : [])
                }
            });
            return { registry, saved };
        };

        const hasBoard = (): boolean => useDocument.getState().views.some((view) => view.id === 'board');

        beforeEach(() => {
            useDocument.getState().load({ ...document, views: [main, board, crew] }, { activeViewId: 'main', views: {} });
        });

        test('names the files it saves and the agents it ends, and saves before it deletes', async () => {
            const { registry, saved } = machineWith(true);
            const asked = await registry.execute('view.delete', { viewId: 'board' }, VOICE_ACTION_CALL);
            if (asked.status !== 'needs_confirmation') {
                throw new Error('Expected confirmation');
            }
            expect(asked.confirmation.consequences).toEqual([
                'The view and its 3 nodes will be removed.',
                '2 chat or terminal sessions may be ended.',
                'Unsaved changes to “notes.md” will be saved first.',
                '“Research” is still working and will be stopped.',
                '“Helper” and an agent were started from this view and will end too.'
            ]);
            expect(saved).toEqual([]);
            expect(hasBoard()).toBe(true);
            expect(await registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL)).toMatchObject({
                status: 'completed',
                output: { viewId: 'board', view: 'Board', kind: 'canvas' }
            });
            expect(saved).toEqual(['/repo/docs/notes.md']);
            expect(hasBoard()).toBe(false);
        });

        test('keeps the view when a file it shows does not save', async () => {
            const { registry, saved } = machineWith(false);
            const asked = await registry.execute('view.delete', { viewId: 'board' }, VOICE_ACTION_CALL);
            if (asked.status !== 'needs_confirmation') {
                throw new Error('Expected confirmation');
            }
            expect(await registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL)).toMatchObject({
                status: 'failed',
                error: { code: 'unsaved-files' }
            });
            expect(saved).toEqual(['/repo/docs/notes.md']);
            expect(hasBoard()).toBe(true);
        });

        test('a view with nothing unsaved or working only says what goes', async () => {
            const { registry } = machineWith(true);
            const asked = await registry.execute('view.delete', { viewId: 'crew' }, PERSON_ACTION_CALL);
            expect(asked).toMatchObject({
                status: 'needs_confirmation',
                confirmation: { consequences: ['The view and its 1 node will be removed.', '1 chat or terminal session may be ended.'] }
            });
        });
    });
});
