import { afterEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import type { ChatInfo, SessionInfo } from '@ruimte/contracts';
import { inspectionActions } from './inspection-actions';
import { useDocument } from '@/state/document';
import type { Transport } from '@/transport/transport';

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
