import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { PulseboardServer } from '../server';

const CHAT = { id: 'chat-1', provider: 'claude', status: 'running' as const, model: null, cwd: '/work' };

describe('Pulseboard on the machine', () => {
    test('counts a turn each time a chat or a terminal starts to work, once however often it is said', async () => {
        const server = await createTestServer<PulseboardServer>({ storage: { chatTurns: 5 } });

        server.fire('chat.status', { chat: CHAT });
        server.fire('chat.status', { chat: CHAT });
        server.fire('chat.status', { chat: { ...CHAT, id: 'chat-2' } });
        server.fire('chat.status', { chat: { ...CHAT, status: 'idle' } });
        server.fire('chat.status', { chat: CHAT });
        server.fire('session.status', { nodeId: 'terminal-1', status: 'running' });
        server.fire('session.status', { nodeId: 'terminal-1', status: 'needsYou' });

        expect(await server.call('counts')).toEqual({ ok: true, value: { chats: 8, terminals: 1 } });
        expect(server.storage).toEqual({ chatTurns: 8, terminalTurns: 1 });
    });

    test('counts only what its manifest lets it follow', async () => {
        const server = await createTestServer<PulseboardServer>({ manifest: { permissions: { 'chats.read': 'Counts', 'notifications.provide': 'Lists' } } });

        server.fire('chat.status', { chat: CHAT });
        server.fire('session.status', { nodeId: 'terminal-1', status: 'running' });

        expect(await server.call('counts')).toEqual({ ok: true, value: { chats: 1, terminals: 0 } });
        expect(server.logs).toContain('session.status needs the permission terminals.read in manifest.json');
    });

    test('keeps what Ruimte told the person through its channel, newest first and at most twenty', async () => {
        const server = await createTestServer<PulseboardServer>();
        const channel = server.notificationChannel('log');

        expect(channel.title).toBe('Pulseboard');
        expect(await channel.deliver({ title: 'Import', body: 'The agent needs your attention.' })).toBe(true);
        expect(await channel.deliver({ title: 'Search', body: 'The turn is done.', reason: 'done' })).toBe(true);
        expect(server.storage.told).toEqual([
            { title: 'Search', body: 'The turn is done.', reason: 'done' },
            { title: 'Import', body: 'The agent needs your attention.', reason: 'needsYou' }
        ]);

        for (let turn = 0; turn < 25; turn++) {
            await channel.deliver({ title: `Turn ${turn}`, reason: 'done' });
        }

        expect(server.storage.told).toHaveLength(20);
        expect(server.storage.told).toContainEqual(expect.objectContaining({ title: 'Turn 24' }));
        expect(server.storage.told).not.toContainEqual(expect.objectContaining({ title: 'Import' }));
    });

    test('answers the history of the account, a row of the week per part of the day', async () => {
        const server = await createTestServer<PulseboardServer>();
        const history = await server.call('history');

        expect(history.ok && history.value.turns).toHaveLength(14);
        expect(history.ok && history.value.byPart.map((row) => row.length)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    });
});
