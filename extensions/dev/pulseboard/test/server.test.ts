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
        const server = await createTestServer<PulseboardServer>({ manifest: { permissions: { 'chats.read': 'Counts' } } });

        server.fire('chat.status', { chat: CHAT });
        server.fire('session.status', { nodeId: 'terminal-1', status: 'running' });

        expect(await server.call('counts')).toEqual({ ok: true, value: { chats: 1, terminals: 0 } });
        expect(server.logs).toContain('session.status needs the permission terminals.read in manifest.json');
    });

    test('answers the history of the account, a row of the week per part of the day', async () => {
        const server = await createTestServer<PulseboardServer>();
        const history = await server.call('history');

        expect(history.ok && history.value.turns).toHaveLength(14);
        expect(history.ok && history.value.byPart.map((row) => row.length)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    });
});
