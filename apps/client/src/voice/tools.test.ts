import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import type { ProjectSummary } from '@ruimte/contracts';
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
    version: 3,
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
    useProjectList.setState({ projects: [] });
    useProject.setState({ switching: false });
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('Voice domain tools', () => {
    test('exposes compact domain tools and confirmation control with strict object inputs', () => {
        expect(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
            'inspect_agents',
            'inspect_agent_activity',
            'manage_projects',
            'inspect_workspace',
            'manage_views',
            'manage_canvas',
            'communicate',
            'control_action'
        ]);
        expect(VOICE_TOOL_DEFINITIONS.every((tool) => tool.strict && tool.parameters.additionalProperties === false)).toBe(true);
    });

    test('clear_ai_chat resolves the selected chat and asks for confirmation', async () => {
        useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} });
        const result = await executeVoiceTool(
            'communicate',
            JSON.stringify({ action: 'clear_ai_chat', chat: null, prompt: null, limit: null, notify_on_completion: false })
        );
        expect(result.output).toMatchObject({ ok: false, needs_confirmation: true });
        expect(result.clearedChatKey).toBeUndefined();
        const cancelled = await executeVoiceTool('control_action', JSON.stringify({ action: 'cancel', confirmation_token: result.output.confirmation_token }));
        expect(cancelled.output.ok).toBe(false);
    });

    test('clear_ai_chat never chooses between duplicate chat names', async () => {
        useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} });
        useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} });
        const result = await executeVoiceTool(
            'communicate',
            JSON.stringify({ action: 'clear_ai_chat', chat: 'Research', prompt: null, limit: null, notify_on_completion: false })
        );
        expect(result.output.ok).toBe(false);
        expect(result.output.candidates).toHaveLength(2);
        expect(result.output.confirmation_token).toBeUndefined();
    });

    test('lists only open projects and never guesses between duplicate names', async () => {
        const summary = (projectId: string, name: string, closedAt: number | null): ProjectSummary => ({
            projectId,
            name,
            closedAt,
            color: '#000',
            folder: '/repo',
            lastOpenedAt: 1,
            available: true,
            icon: { kind: 'initial', value: 'F' },
            nameSource: 'chosen'
        });
        useProjectList.setState({
            projects: [
                { endpointId: 'one', summary: summary('p1', 'Flux', null) },
                { endpointId: 'two', summary: summary('p2', 'Flux', null) },
                { endpointId: 'one', summary: summary('p3', 'Closed', 1) }
            ]
        });
        const listed = await executeVoiceTool('manage_projects', JSON.stringify({ action: 'list', project: null, machine: null }));
        expect(listed.output.ok).toBe(true);
        expect(listed.output.projects).toHaveLength(2);
        const ambiguous = await executeVoiceTool('manage_projects', JSON.stringify({ action: 'switch', project: 'Flux', machine: null }));
        expect(ambiguous.output.ok).toBe(false);
        expect(ambiguous.output.candidates).toHaveLength(2);
        const closed = await executeVoiceTool('manage_projects', JSON.stringify({ action: 'switch', project: 'Closed', machine: null }));
        expect(closed.output.ok).toBe(false);
    });

    test('offline agent status is unknown rather than idle or successful', async () => {
        defaultCanvases.of('main').getState().addNode('chat', { x: 0, y: 0 }, { title: 'Research' });
        const result = await executeVoiceTool('inspect_agents', JSON.stringify({ agent: 'Research', scope: 'all' }));
        expect(result.output).toMatchObject({ ok: true, connected: false, agents: [{ name: 'Research', status: 'unknown', working: null }] });
    });

    test('selected activity requires exactly one agent and reports unsupported terminal history', async () => {
        defaultCanvases.of('main').getState().select([]);
        expect((await executeVoiceTool('inspect_agent_activity', JSON.stringify({ agent: null, limit: 5, tool_id: null }))).output.ok).toBe(false);
        defaultCanvases.of('main').getState().addNode('terminal', { x: 0, y: 0 }, { title: 'CLI' });
        const result = await executeVoiceTool('inspect_agent_activity', JSON.stringify({ agent: 'CLI', limit: 5, tool_id: null }));
        expect(result.output).toMatchObject({ ok: true, supported: false, tools: [] });
    });

    test('workspace actions refuse while the project is switching', async () => {
        useProject.setState({ switching: true });
        const result = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'focus', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(result.output.ok).toBe(false);
        expect(useDocument.getState().activeViewId).toBe('main');
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

    test('a confirmation cannot survive leaving and returning to the workspace', async () => {
        const requested = await executeVoiceTool(
            'manage_views',
            JSON.stringify({ action: 'delete', view: 'Release', kind: null, name: null, url: null, command: null })
        );
        expect(requested.output.needs_confirmation).toBe(true);
        useProject.setState({ switching: true });
        useProject.setState({ switching: false });
        const confirmed = await executeVoiceTool(
            'control_action',
            JSON.stringify({ action: 'confirm', confirmation_token: requested.output.confirmation_token })
        );
        expect(confirmed.output.ok).toBe(false);
        expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(true);
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
