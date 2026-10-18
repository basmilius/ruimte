import { afterEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ProjectDocument } from '@ruimte/contracts';
import { ActionRefusal } from '@ruimte/actions';
import { createClientActionRegistry, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { useChats } from '@adecore/agents-react/state';
import { useDocument } from '@/state/document';

const document: ProjectDocument = {
    version: 3,
    rev: 1,
    name: 'Atlas',
    color: '#000',
    views: [{ kind: 'chat', id: 'research', name: 'Research', node: {} }]
};

const thread: ChatItem[] = [
    { id: '1', kind: 'user', text: 'Explain generics', createdAt: 1, turnId: 'turn-1' },
    { id: '2', kind: 'assistant', text: 'Generics let a type take a type.', streaming: false, createdAt: 2, turnId: 'turn-1' }
];

afterEach(() => {
    useDocument.getState().load(null, null);
    useChats.setState({ byKey: {} });
});

describe('chat.read', () => {
    test('reads a chat nobody opened in this window through an inspection', async () => {
        useDocument.getState().load(document, { activeViewId: 'research', views: {} });
        const inspected: string[] = [];
        const registry = createClientActionRegistry(useDocument, {
            inspectChat: async (chatId) => {
                inspected.push(chatId);
                return { items: thread };
            }
        });

        const result = await registry.execute('chat.read', { chatId: 'research', limit: null }, VOICE_ACTION_CALL);

        expect(inspected).toEqual(['research']);
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                chat: 'Research',
                messages: [
                    { role: 'user', text: 'Explain generics' },
                    { role: 'assistant', text: 'Generics let a type take a type.' }
                ]
            }
        });
    });

    test('an inspection that fails is a refusal, not a crash', async () => {
        useDocument.getState().load(document, { activeViewId: 'research', views: {} });
        const registry = createClientActionRegistry(useDocument, {
            inspectChat: async () => {
                throw new ActionRefusal('offline', 'The machine is disconnected.');
            }
        });

        const result = await registry.execute('chat.read', { chatId: 'research', limit: null }, VOICE_ACTION_CALL);

        expect(result).toMatchObject({ status: 'failed', error: { code: 'offline' } });
    });
});
