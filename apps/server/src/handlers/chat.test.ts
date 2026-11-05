import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { Dispatcher } from '../dispatcher.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ClientAccess } from '../wire.ts';
import { registerChatHandlers } from './chat.ts';
import { askOnce } from './test-helpers.ts';

function register(started: string[]): Dispatcher {
    const dispatcher = new Dispatcher();
    const manager = {
        create: async (payload: { chatId: string }) => {
            started.push(payload.chatId);
            return { chatId: payload.chatId };
        },
        attachWithBookmarks: async (chatId: string) => {
            started.push(chatId);
            return { chatId };
        },
        toolOutput: async (chatId: string, itemId: string) => {
            started.push(chatId);
            return `whole output of ${itemId}`;
        }
    } as unknown as ChatManager;
    registerChatHandlers(dispatcher, manager, {} as ProviderRegistry, undefined, undefined, undefined, undefined, undefined, (nodeId) =>
        nodeId === 'remote' ? 'machine-b' : null
    );
    return dispatcher;
}

function ask(dispatcher: Dispatcher, type: string, payload: unknown, access?: ClientAccess): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client', access }, type, payload);
}

describe('a chat that runs on another machine', () => {
    test('is neither created nor attached here', async () => {
        const started: string[] = [];
        const dispatcher = register(started);
        expect(await ask(dispatcher, 'chat.create', { chatId: 'remote' })).toMatchObject({ ok: false, error: { code: 'node-on-other-machine' } });
        expect(await ask(dispatcher, 'chat.attach', { chatId: 'remote' })).toMatchObject({ ok: false, error: { code: 'node-on-other-machine' } });
        expect(await ask(dispatcher, 'chat.toolOutput', { chatId: 'remote', itemId: 'tool-1' })).toMatchObject({
            ok: false,
            error: { code: 'node-on-other-machine' }
        });
        expect(started).toEqual([]);
    });

    test('leaves every other chat alone', async () => {
        const started: string[] = [];
        const dispatcher = register(started);
        expect(await ask(dispatcher, 'chat.create', { chatId: 'local' })).toMatchObject({ ok: true });
        expect(await ask(dispatcher, 'chat.attach', { chatId: 'local' })).toMatchObject({ ok: true });
        expect(started).toEqual(['local', 'local']);
    });
});

describe('the whole output of a tool call', () => {
    test('is read for a client of this machine', async () => {
        const dispatcher = register([]);

        expect(await ask(dispatcher, 'chat.toolOutput', { chatId: 'local', itemId: 'tool-1' })).toMatchObject({
            ok: true,
            result: { output: 'whole output of tool-1' }
        });
        expect(dispatcher.types()).toContain('chat.toolOutput');
    });

    test('is refused to another machine that works here, as every chat request is', async () => {
        const started: string[] = [];
        const dispatcher = register(started);
        const peer: ClientAccess = { reachability: 'tunnel', sessionId: 'session-a', peer: { machineId: 'machine-a' } };

        expect(await ask(dispatcher, 'chat.toolOutput', { chatId: 'local', itemId: 'tool-1' }, peer)).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(await ask(dispatcher, 'chat.attach', { chatId: 'local' }, peer)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(started).toEqual([]);
        expect(dispatcher.peerTypes()).not.toContain('chat.toolOutput');
    });
});
