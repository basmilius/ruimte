import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VOICE_TOOL_DEFINITIONS, type ProjectCanvasView, type ProjectDocument, type ProjectNode } from '@ruimte/contracts';
import { defaultCanvases } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { executeVoiceTool } from '@/voice/tools';

const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const document: ProjectDocument = {
    version: 2,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [main, { kind: 'canvas', id: 'release', name: 'Release', nodes: [], texts: [], edges: [], layouts: [] }]
};

const canvasNode = (id: string, title: string, kind: ProjectNode['kind'], x: number): ProjectNode => ({
    id,
    title,
    kind,
    x,
    y: 100,
    w: 240,
    h: 160
});

const canvasArgs = (overrides: Record<string, unknown>): string =>
    JSON.stringify({
        action: 'fit',
        node: null,
        kind: null,
        name: null,
        title: null,
        content: null,
        url: null,
        command: null,
        nodes: null,
        scope: null,
        ...overrides
    });

beforeEach(() => {
    useSettings.setState({ voiceConfirmDestructiveActions: true });
    useDocument.getState().load(document, { activeViewId: 'main', views: {} });
    defaultCanvases.of('main').getState().loadView(main, null);
    defaultCanvases.focus('main');
});

afterEach(() => {
    useSettings.setState({ voiceConfirmDestructiveActions: true });
    useDocument.getState().load(null, null);
    useChats.setState({ byKey: {} });
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('Voice domain tools', () => {
    test('exposes compact domain tools and confirmation control with strict object inputs', () => {
        expect(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
            'inspect_workspace',
            'manage_views',
            'manage_canvas',
            'communicate',
            'control_action'
        ]);
        expect(VOICE_TOOL_DEFINITIONS.every((tool) => tool.strict && tool.parameters.additionalProperties === false)).toBe(true);
    });

    test('focuses a view through manage_views and the shared registry', async () => {
        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'focus', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(result.output).toMatchObject({ ok: true, message: 'Focused the view “Release”.', viewId: 'release' });
        expect(result.action).toMatchObject({ kind: 'focus', label: 'Focused view', detail: 'Release' });
        expect(useDocument.getState().activeViewId).toBe('release');
    });

    test('creates a complete reminder note through manage_canvas', async () => {
        const result = await executeVoiceTool(
            'manage_canvas',
            canvasArgs({
                action: 'create_node',
                kind: 'note',
                content: 'Fleur morgen mijn iPhone laten zien'
            })
        );
        expect(result.output).toMatchObject({ ok: true, kind: 'note', node: 'Fleur morgen mijn iPhone laten zien' });
        expect(Object.values(defaultCanvases.of('main').getState().nodes)[0]).toMatchObject({ body: 'Fleur morgen mijn iPhone laten zien' });
    });

    test('refuses equally named views instead of choosing the first one', async () => {
        useDocument
            .getState()
            .load(
                { ...document, views: [...document.views, { kind: 'chat', id: 'release-chat', name: 'release', node: {} }] },
                { activeViewId: 'main', views: {} }
            );
        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'focus', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(result.output).toMatchObject({ ok: false, candidates: [{ id: 'release' }, { id: 'release-chat' }] });
        expect(useDocument.getState().activeViewId).toBe('main');
    });

    test('returns every candidate for an ambiguous partial view name', async () => {
        useDocument.getState().load(
            {
                ...document,
                views: [
                    main,
                    { kind: 'canvas', id: 'release-plan', name: 'Release Plan', nodes: [], texts: [], edges: [], layouts: [] },
                    { kind: 'chat', id: 'release-chat', name: 'Release Chat', node: {} }
                ]
            },
            { activeViewId: 'main', views: {} }
        );
        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'focus', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(result.output).toMatchObject({ ok: false, candidates: [{ id: 'release-plan' }, { id: 'release-chat' }] });
        expect(useDocument.getState().activeViewId).toBe('main');
    });

    test('groups only nodes intersecting the current viewport', async () => {
        const visible = canvasNode('visible', 'Visible note', 'note', 100);
        const far = canvasNode('far', 'Far note', 'note', 4000);
        defaultCanvases.of('main').setState({
            nodes: { visible, far },
            order: ['visible', 'far'],
            viewport: { w: 1200, h: 800 },
            camera: { x: 0, y: 0, zoom: 1 }
        });
        const result = await executeVoiceTool('manage_canvas', canvasArgs({ action: 'group_nodes', kind: 'note', scope: 'visible' }));
        expect(result.output).toMatchObject({ ok: true, members: ['visible'] });
        expect(defaultCanvases.of('main').getState().nodes.far).toBeDefined();
    });

    test('reports which nodes are currently inside the viewport', async () => {
        const visible = canvasNode('visible', 'Visible note', 'note', 100);
        const far = canvasNode('far', 'Far note', 'note', 4000);
        defaultCanvases.of('main').setState({
            nodes: { visible, far },
            order: ['visible', 'far'],
            viewport: { w: 1200, h: 800 },
            camera: { x: 0, y: 0, zoom: 1 }
        });
        const result = await executeVoiceTool('inspect_workspace', '{}');
        expect(result.output).toMatchObject({
            ok: true,
            workspace: {
                canvas: {
                    nodes: [
                        { id: 'visible', visible: true },
                        { id: 'far', visible: false }
                    ]
                }
            }
        });
    });

    test('deletes nodes only after a later confirmation tool call', async () => {
        const note = canvasNode('note', 'Disposable note', 'note', 100);
        defaultCanvases.of('main').setState({ nodes: { note }, order: ['note'], selection: ['note'] });
        const requested = await executeVoiceTool('manage_canvas', canvasArgs({ action: 'delete_nodes', scope: 'selected' }));
        expect(requested.output).toMatchObject({ ok: false, needs_confirmation: true });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeDefined();
        const token = String(requested.output.confirmation_token);
        const confirmed = await executeVoiceTool('control_action', JSON.stringify({ action: 'confirm', confirmation_token: token }));
        expect(confirmed.output).toMatchObject({ ok: true, nodeIds: ['note'] });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeUndefined();
    });

    test('keeps a view until its deletion is confirmed', async () => {
        const requested = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'delete', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(requested.output).toMatchObject({ ok: false, needs_confirmation: true });
        expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(true);
        const confirmed = await executeVoiceTool(
            'control_action',
            JSON.stringify({ action: 'confirm', confirmation_token: requested.output.confirmation_token })
        );
        expect(confirmed.output).toMatchObject({ ok: true, viewId: 'release' });
        expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(false);
    });

    test('deletes nodes immediately when Voice confirmation is disabled', async () => {
        useSettings.setState({ voiceConfirmDestructiveActions: false });
        const note = canvasNode('note', 'Disposable note', 'note', 100);
        defaultCanvases.of('main').setState({ nodes: { note }, order: ['note'], selection: ['note'] });

        const result = await executeVoiceTool('manage_canvas', canvasArgs({ action: 'delete_nodes', scope: 'selected' }));

        expect(result.output).toMatchObject({ ok: true, nodeIds: ['note'] });
        expect(result.action).toMatchObject({ kind: 'delete', label: 'Deleted nodes' });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeUndefined();
    });

    test('deletes a view immediately when Voice confirmation is disabled', async () => {
        useSettings.setState({ voiceConfirmDestructiveActions: false });

        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'delete', view: 'Release', kind: null, name: null, url: null, command: null })
        );

        expect(result.output).toMatchObject({ ok: true, viewId: 'release' });
        expect(result.action).toMatchObject({ kind: 'delete', label: 'Deleted view' });
        expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(false);
    });

    test('reads only a limited recent excerpt from a loaded AI Chat', async () => {
        useDocument
            .getState()
            .load(
                { ...document, views: [...document.views, { kind: 'chat', id: 'chat-test', name: 'Chat Test', node: {} }] },
                { activeViewId: 'main', views: {} }
            );
        const items = [
            { id: '1', kind: 'user' as const, text: 'First question', createdAt: 1, turnId: null },
            { id: '2', kind: 'assistant' as const, text: 'First answer', streaming: false, createdAt: 2, turnId: null },
            { id: '3', kind: 'user' as const, text: 'Latest question', createdAt: 3, turnId: null }
        ];
        const byId = Object.fromEntries(items.map((item) => [item.id, item]));
        useChats.setState({
            byKey: {
                [endpointKey(currentEndpointId(), 'chat-test')]: {
                    info: {} as never,
                    items: byId,
                    structure: byId,
                    order: ['1', '2', '3']
                }
            }
        });
        const result = await executeVoiceTool(
            'communicate',
            JSON.stringify({ action: 'read_ai_chat', chat: 'Chat Test', prompt: null, limit: 2, notify_on_completion: false })
        );
        expect(result.output).toMatchObject({
            ok: true,
            messages: [
                { role: 'assistant', text: 'First answer' },
                { role: 'user', text: 'Latest question' }
            ],
            truncated: true
        });
    });
});
