import { afterEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import type { ChatInfo, ProjectCanvasView, SessionInfo } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { pool } from '@/transport';
import type { Transport } from '@/transport/transport';
import { inspectionActions } from './inspection-actions';

const call = { actor: { kind: 'voice' as const, id: 'test' }, context: undefined };

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('voice inspection actions', () => {
    test('reads fresh statuses, excludes plain shells and does not call a stale agent busy', async () => {
        useDocument.getState().load(
            {
                version: 3,
                rev: 0,
                name: 'Test',
                color: '#000',
                views: [
                    { id: 'chat', name: 'Research', kind: 'chat', node: {} },
                    { id: 'terminal', name: 'Coder', kind: 'terminal', node: {} },
                    { id: 'plain', name: 'Shell', kind: 'terminal', node: {} }
                ]
            },
            null
        );
        const chats = [{ chatId: 'chat', status: 'needs-you' }] as ChatInfo[];
        const sessions = [
            { sessionId: 'terminal', agent: { kind: 'codex', live: false, status: 'running', updatedAt: 1 } },
            { sessionId: 'plain', agent: null }
        ] as SessionInfo[];
        const transport: Transport = {
            status: 'open',
            request: (async (type: string) => (type === 'chat.list' ? { chats } : { sessions })) as Transport['request'],
            on: () => () => {},
            subscribeStatus: () => () => {}
        };
        const actions = new ActionRegistry(inspectionActions(useDocument, { transport: () => transport }));
        const result = await actions.execute('agents.inspect', {}, call);
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                connected: true,
                agents: [
                    { id: 'chat', status: 'needs-you', working: false },
                    { id: 'terminal', status: 'unknown', working: null }
                ]
            }
        });
    });
});

describe('inspection of a node on another machine', () => {
    const FAR = 'far-machine';

    const loadFarCanvas = (): void => {
        const view = {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'chat-here', kind: 'chat', title: 'Here', x: 0, y: 0, w: 400, h: 400 },
                { id: 'chat-far', kind: 'chat', title: 'Far', x: 500, y: 0, w: 400, h: 400, machine: FAR }
            ],
            texts: [],
            edges: [],
            layouts: []
        } as unknown as ProjectCanvasView;
        useDocument.getState().load({ version: 3, rev: 0, name: 'Far', color: '#000', views: [view] }, { activeViewId: 'main', views: {} });
    };

    const machineWith = (chats: ChatInfo[], asked: string[], name: string): Transport => ({
        status: 'open',
        request: (async (type: string) => {
            asked.push(`${name} ${type}`);
            return type === 'chat.list' ? { chats } : { sessions: [] };
        }) as Transport['request'],
        on: () => () => {},
        subscribeStatus: () => () => {}
    });

    test('agents.inspect asks each node the machine it runs on', async () => {
        loadFarCanvas();
        const asked: string[] = [];
        const here = machineWith(
            [
                { chatId: 'chat-here', status: 'idle' },
                { chatId: 'chat-far', status: 'needs-you' }
            ] as ChatInfo[],
            asked,
            'here'
        );
        const far = machineWith([{ chatId: 'chat-far', status: 'running' }] as ChatInfo[], asked, 'far');
        const actions = new ActionRegistry(inspectionActions(useDocument, { transport: (endpointId) => (endpointId === FAR ? far : here) }));

        const result = await actions.execute('agents.inspect', {}, call);

        expect(result).toMatchObject({
            status: 'completed',
            output: {
                connected: true,
                agents: [
                    { id: 'chat-here', status: 'idle' },
                    { id: 'chat-far', status: 'running' }
                ]
            }
        });
        expect(asked.toSorted()).toEqual(['far chat.list', 'far session.list', 'here chat.list', 'here session.list']);
    });

    test('agents.inspect leaves a node on a machine that is not connected unknown', async () => {
        loadFarCanvas();
        const here = machineWith([{ chatId: 'chat-far', status: 'needs-you' }] as ChatInfo[], [], 'here');
        const actions = new ActionRegistry(inspectionActions(useDocument, { transport: (endpointId) => (endpointId === FAR ? null : here) }));

        const result = await actions.execute('agents.inspect', {}, call);

        expect(result).toMatchObject({ output: { agents: [{ id: 'chat-here' }, { id: 'chat-far', status: 'unknown', working: null }] } });
    });

    test('agent.activity of a node on a machine this client does not know refuses and asks no machine', async () => {
        loadFarCanvas();
        const asked: string[] = [];
        const here = machineWith([], asked, 'here');
        const actions = new ActionRegistry(inspectionActions(useDocument, { transport: () => here }));

        const result = await actions.execute('agent.activity', { agentId: 'chat-far', limit: 5, toolId: null }, call);

        expect(result).toMatchObject({ status: 'failed', error: { code: 'no-machine' } });
        expect(asked).toEqual([]);
        expect(pool.peek('local')).toBeNull();
    });
});
