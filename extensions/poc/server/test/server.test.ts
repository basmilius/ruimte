import { describe, expect, test } from 'bun:test';
import { createTestServer, refusal } from '@ruimte/extension/testing';
import type { PocServer } from '../server';

const ALL = {
    clock: 'Ticks',
    'agents.run': 'Asks',
    'chats.read': 'Counts',
    'chats.send': 'Pokes',
    'agents.tools': 'Offers',
    'agents.start': 'Starts'
};

function without(permission: keyof typeof ALL): Record<string, string> {
    const { [permission]: _gone, ...rest } = ALL;

    return rest;
}

describe('poc-server under createTestServer', () => {
    test('counts on from what storage holds, and its storage and logs show it', async () => {
        const server = await createTestServer<PocServer>({ storage: { count: 2 } });

        expect(await server.call('count')).toEqual({ ok: true, value: 3 });
        expect(server.storage).toEqual({ count: 3 });
        expect(server.logs).toEqual(['Counted to 3']);
    });

    test('keeps a secret, and answers a throw and a missing method as the client reads them', async () => {
        const server = await createTestServer<PocServer>();

        expect(await server.call('remember', 'value')).toEqual({ ok: true, value: true });
        expect(server.secrets).toEqual({ value: 'value' });
        expect(await server.call('fail')).toEqual({ ok: false, error: { code: 'failed', message: 'On purpose' } });
        expect(await server.call('gone' as never)).toEqual({ ok: false, error: { code: 'not-found', message: 'No method gone' } });
    });

    test('ticks only as the clock moves, and says so to clients', async () => {
        const server = await createTestServer<PocServer>();

        await server.clock.advance('9s');

        expect(await server.call('ticks')).toEqual({ ok: true, value: 0 });

        await server.clock.advance('25s');

        expect(await server.call('ticks')).toEqual({ ok: true, value: 3 });
        expect(server.emitted.map((said) => said.payload)).toEqual([{ ticks: 1 }, { ticks: 2 }, { ticks: 3 }]);
        expect(server.clock.now()).toBe(34_000);
    });

    test('refuses schedule without the permission clock', async () => {
        await expect(createTestServer({ manifest: { permissions: without('clock') } })).rejects.toThrow('schedule needs the permission clock in manifest.json');
    });

    test('hears a machine event only with its permission', async () => {
        const chat = { id: 'chat-1', provider: 'claude', status: 'idle' as const, model: null, cwd: '/work' };
        const allowed = await createTestServer<PocServer>();
        const refused = await createTestServer<PocServer>({ manifest: { permissions: without('chats.read') } });

        allowed.fire('chat.status', { chat });
        refused.fire('chat.status', { chat });

        expect(await allowed.call('eventsSeen')).toEqual({ ok: true, value: 1 });
        expect(await refused.call('eventsSeen')).toEqual({ ok: true, value: 0 });
        expect(refused.logs).toContain('chat.status needs the permission chats.read in manifest.json');
    });

    test('answers an agent through its tool, and reads its node, only as the manifest allows', async () => {
        const server = await createTestServer<PocServer>();

        expect(await server.tool('fact').run({ about: 'Life' }, { caller: 'chat-1' })).toBe('Life is 42, for chat-1');
        expect(await server.nodeContext('fact', { fact: 'The sky is blue' })).toEqual([{ text: 'The sky is blue' }]);

        const hidden = await createTestServer<PocServer>({ manifest: { permissions: without('agents.tools') } });

        await expect(hidden.tool('fact').run()).rejects.toThrow('defineAgentTool needs the permission agents.tools');
    });

    test('asks the machine what the test scripts, and records it', async () => {
        const server = await createTestServer<PocServer>({
            answers: {
                'agents.run': ({ prompt }) => ({ text: `You said ${prompt}` }),
                'agents.start': ({ project }) => ({ id: `chat-in-${project.id}` }),
                'chats.list': () => {
                    throw refusal('refused', 'Not now');
                }
            }
        });

        expect(await server.call('ask', 'hi')).toEqual({ ok: true, value: { ok: true, value: { text: 'You said hi' } } });
        expect(await server.call('startChat', 'project-1')).toEqual({ ok: true, value: { ok: true, value: { id: 'chat-in-project-1' } } });
        expect(await server.call('chatCount')).toEqual({ ok: true, value: 'refused' });
        expect(await server.call('poke', 'chat-1')).toMatchObject({ value: { ok: false, error: { code: 'unavailable' } } });
        expect(server.asked.map((ask) => ask.method)).toEqual(['agents.run', 'agents.start', 'chats.list', 'chats.send']);
        expect(server.asked[1]?.args).toEqual([{ project: { id: 'project-1' }, title: 'From poc-server', prompt: 'Say hello from poc-server.' }]);
    });

    test('sends a chat at most 20 messages an hour, on the test clock', async () => {
        const server = await createTestServer<PocServer>({ answers: { 'chats.send': () => undefined } });
        const pokes = [];

        for (let poke = 0; poke < 21; poke++) {
            pokes.push(await server.call('poke', 'chat-1'));
        }

        expect(pokes.slice(0, 20).every((poke) => poke.ok && poke.value.ok)).toBe(true);
        expect(pokes[20]).toMatchObject({
            value: { ok: false, error: { code: 'limit', message: 'poc.server sent chat-1 20 messages this hour and has to wait' } }
        });

        await server.clock.advance('1h');

        expect(await server.call('poke', 'chat-1')).toMatchObject({ ok: true, value: { ok: true } });
    });

    test('refuses what the manifest does not ask for, with the code and words of the machine', async () => {
        const server = await createTestServer<PocServer>({ manifest: { permissions: without('chats.send') }, answers: { 'chats.send': () => undefined } });

        expect(await server.call('poke', 'chat-1')).toEqual({
            ok: true,
            value: { ok: false, error: { code: 'permission-denied', message: 'poc.server did not ask for the permission chats.send in its manifest' } }
        });
    });
});
