import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import type { ProjectSummary } from '@ruimte/contracts';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { VOICE_TOOL_ACTIONS, VOICE_TOOL_DEFINITIONS } from '@ruimte/actions';
import type { ProjectCanvasView, ProjectDocument, ProjectNode } from '@ruimte/contracts';
import { clientActions, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { defaultCanvases } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { bypassesQueue, executeVoiceTool } from '@/voice/tools';

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

/* A strict tool call carries every field of its tool, null where the action has no use for it. */
const toolArgs = (tool: string, fields: Record<string, unknown>): string => {
    const definition = VOICE_TOOL_DEFINITIONS.find((candidate) => candidate.name === tool)!;
    const nulls = Object.fromEntries(Object.keys(definition.parameters.properties).map((field) => [field, null]));
    return JSON.stringify({ ...nulls, ...(tool === 'communicate' ? { notify_on_completion: false } : {}), ...fields });
};

const run = (tool: string, fields: Record<string, unknown>) => executeVoiceTool(tool, toolArgs(tool, fields));

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
    test('every tool action has a client handler Voice may run', () => {
        const handled = clientActions.catalog(VOICE_ACTION_CALL).map((entry) => entry.name);
        expect([...VOICE_TOOL_ACTIONS.values()].flat().sort()).toEqual([...handled].sort());
    });

    test('refuses an action its tool does not reach', async () => {
        const result = await run('manage_views', { action: 'node.focus', viewId: 'main' });
        expect(result.output).toMatchObject({ ok: false });
        expect(useDocument.getState().activeViewId).toBe('main');
    });

    test('chat.clear asks for confirmation', async () => {
        const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Research', node: {} });
        const result = await run('communicate', { action: 'chat.clear', chatId });
        expect(result.output).toMatchObject({ ok: false, needs_confirmation: true });
        expect(result.clearedChatKey).toBeUndefined();
        const cancelled = await executeVoiceTool('control_action', JSON.stringify({ action: 'cancel', confirmation_token: result.output.confirmation_token }));
        expect(cancelled.output.ok).toBe(false);
    });

    test('lists projects in use and under Recent, and resolves a name to one in use before one under Recent', async () => {
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
        const listed = await run('manage_projects', { action: 'project.list' });
        expect(listed.output.ok).toBe(true);
        expect(listed.output.projects).toHaveLength(3);
        const ambiguous = await run('inspect_workspace', { action: 'target.resolve', target: 'project', names: ['Flux'] });
        expect(ambiguous.output).toMatchObject({ ok: true, found: [], ambiguous: [{ name: 'Flux', candidates: [{ id: 'p1' }, { id: 'p2' }] }] });
        const recent = await run('inspect_workspace', { action: 'target.resolve', target: 'project', names: ['Closed'] });
        expect(recent.output).toMatchObject({ ok: true, found: [{ id: 'p3' }] });
    });

    test('offline agent status is unknown rather than idle or successful', async () => {
        defaultCanvases.of('main').getState().addNode('chat', { x: 0, y: 0 }, { title: 'Research' });
        const result = await run('inspect_agents', { action: 'agents.inspect' });
        expect(result.output).toMatchObject({ ok: true, connected: false, agents: [{ name: 'Research', status: 'unknown', working: null }] });
    });

    test('reports unsupported terminal history for a resolved agent', async () => {
        defaultCanvases.of('main').getState().select([]);
        const none = await run('inspect_workspace', { action: 'target.resolve', target: 'agent' });
        expect(none.output).toMatchObject({ ok: true, found: [] });
        defaultCanvases.of('main').getState().addNode('terminal', { x: 0, y: 0 }, { title: 'CLI' });
        const resolved = await run('inspect_workspace', { action: 'target.resolve', target: 'agent', names: ['CLI'] });
        const agentId = (resolved.output.found as { id: string }[])[0]?.id;
        const result = await run('inspect_agents', { action: 'agent.activity', agentId, limit: 5 });
        expect(result.output).toMatchObject({ ok: true, supported: false, tools: [] });
    });

    test('git over a project without a machine says why instead of reporting a result', async () => {
        const result = await run('manage_git', { action: 'git.status' });
        expect(result.output).toMatchObject({ ok: false });
        expect(result.action).toBeUndefined();
    });

    test('workspace actions refuse while the project is switching', async () => {
        useProject.setState({ switching: true });
        const result = await run('manage_views', { action: 'view.focus', viewId: 'release' });
        expect(result.output.ok).toBe(false);
        expect(useDocument.getState().activeViewId).toBe('main');
    });

    test('focuses a view through manage_views and the shared registry', async () => {
        const result = await run('manage_views', { action: 'view.focus', viewId: 'release' });
        expect(result.output).toMatchObject({ ok: true, message: 'Focused the view “Release”.', viewId: 'release' });
        expect(result.action).toMatchObject({ kind: 'focus', label: 'Focused view', detail: 'Release' });
        expect(useDocument.getState().activeViewId).toBe('release');
    });

    test('reports a refused input with the registry’s own message', async () => {
        const result = await run('manage_views', { action: 'view.rename', viewId: 'release' });
        expect(result.output).toMatchObject({ ok: false, code: 'invalid-input' });
    });

    test('creates a complete reminder note through manage_canvas', async () => {
        const result = await run('manage_canvas', { action: 'node.create', viewId: 'main', kind: 'note', content: 'Fleur morgen mijn iPhone laten zien' });
        expect(result.output).toMatchObject({ ok: true, kind: 'note', node: 'Fleur morgen mijn iPhone laten zien' });
        expect(result.action).toMatchObject({ kind: 'note', label: 'Added note' });
        expect(Object.values(defaultCanvases.of('main').getState().nodes)[0]).toMatchObject({ body: 'Fleur morgen mijn iPhone laten zien' });
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
        const resolved = await run('inspect_workspace', { action: 'target.resolve', target: 'node', nodeKind: 'note', scope: 'visible' });
        const nodeIds = (resolved.output.found as { id: string }[]).map((node) => node.id);
        const result = await run('manage_canvas', { action: 'group.create', viewId: 'main', nodeIds });
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
        const result = await run('inspect_workspace', { action: 'workspace.inspect' });
        expect(result.output).toMatchObject({
            ok: true,
            canvas: {
                nodes: [
                    { id: 'visible', visible: true },
                    { id: 'far', visible: false }
                ]
            }
        });
    });

    test('deletes nodes only after a later confirmation tool call', async () => {
        const note = canvasNode('note', 'Disposable note', 'note', 100);
        defaultCanvases.of('main').setState({ nodes: { note }, order: ['note'], selection: ['note'] });
        const requested = await run('manage_canvas', { action: 'node.delete', viewId: 'main', nodeIds: ['note'] });
        expect(requested.output).toMatchObject({ ok: false, needs_confirmation: true });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeDefined();
        const token = String(requested.output.confirmation_token);
        const confirmed = await executeVoiceTool('control_action', JSON.stringify({ action: 'confirm', confirmation_token: token }));
        expect(confirmed.output).toMatchObject({ ok: true, nodeIds: ['note'] });
        expect(confirmed.action).toMatchObject({ kind: 'delete', label: 'Deleted nodes', detail: 'Disposable note' });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeUndefined();
    });

    test('keeps a view until its deletion is confirmed', async () => {
        const requested = await run('manage_views', { action: 'view.delete', viewId: 'release' });
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
        const requested = await run('manage_views', { action: 'view.delete', viewId: 'release' });
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

        const result = await run('manage_canvas', { action: 'node.delete', viewId: 'main', nodeIds: ['note'] });

        expect(result.output).toMatchObject({ ok: true, nodeIds: ['note'] });
        expect(result.action).toMatchObject({ kind: 'delete', label: 'Deleted nodes' });
        expect(defaultCanvases.of('main').getState().nodes.note).toBeUndefined();
    });

    test('deletes a view immediately when Voice confirmation is disabled', async () => {
        useSettings.setState({ voiceConfirmDestructiveActions: false });

        const result = await run('manage_views', { action: 'view.delete', viewId: 'release' });

        expect(result.output).toMatchObject({ ok: true, viewId: 'release' });
        expect(result.action).toMatchObject({ kind: 'delete', label: 'Deleted view' });
        expect(useDocument.getState().views.some((view) => view.id === 'release')).toBe(false);
    });

    test('an action that only moves something keeps its question when deletions skip theirs', async () => {
        useSettings.setState({ voiceConfirmDestructiveActions: false });
        defaultCanvases.of('main').getState().saveLayout('Wide');

        const saved = await run('manage_layout', { action: 'layout.save', viewId: 'main', name: 'Wide' });

        expect(saved.output).toMatchObject({ ok: false, needs_confirmation: true });
    });

    test('sends a prompt and follows its completion when asked to', async () => {
        const chatId = useDocument.getState().addStandaloneView({ kind: 'chat', name: 'Chat Test', node: {} });
        // A turn id only comes from a machine, so the send itself answers as one would.
        const send = spyOn(clientActions, 'execute').mockResolvedValue({
            status: 'completed',
            action: 'chat.send',
            output: { chatId, chat: 'Chat Test', queued: false, turnId: 'turn-1' }
        });
        try {
            const result = await run('communicate', { action: 'chat.send', chatId, prompt: 'Give a motivating quote', notify_on_completion: true });
            expect(send).toHaveBeenCalledWith(
                'chat.send',
                { chatId, prompt: 'Give a motivating quote', mentions: null, skills: null, attachments: null },
                VOICE_ACTION_CALL
            );
            expect(result.output).toMatchObject({ ok: true, message: 'Submitted the prompt in “Chat Test”.' });
            expect(result.action).toMatchObject({ kind: 'chat', label: 'Prompted AI Chat', detail: 'Chat Test: Give a motivating quote' });
            expect(result.followUp).toMatchObject({ key: endpointKey(currentEndpointId(), chatId), chat: 'Chat Test', turnId: 'turn-1' });
        } finally {
            send.mockRestore();
        }
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
        const result = await run('communicate', { action: 'chat.read', chatId: 'chat-test', limit: 2 });
        expect(result.output).toMatchObject({
            ok: true,
            messages: [
                { role: 'assistant', text: 'First answer' },
                { role: 'user', text: 'Latest question' }
            ],
            truncated: true
        });
    });

    test('only a cancel runs beside the queue, since it is for the run the queue waits on', () => {
        expect(bypassesQueue('manage_git', JSON.stringify({ action: 'operation.cancel', operationId: null }))).toBe(true);
        expect(bypassesQueue('manage_git', JSON.stringify({ action: 'git.push', repository: null }))).toBe(false);
        expect(bypassesQueue('manage_views', JSON.stringify({ action: 'operation.cancel' }))).toBe(false);
        expect(bypassesQueue('manage_git', 'not json')).toBe(false);
    });
});
