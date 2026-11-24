import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { TracklineServer } from '../server';

const KEY = 'trk_demo1234';
const WITHOUT_CHATS = { 'agents.tools': 'Looks up', clock: 'Checks', 'ui.provide': 'Shows' };

function connected(options: Parameters<typeof createTestServer>[0] = {}) {
    return createTestServer<TracklineServer>({ secrets: { key: KEY }, ...options });
}

describe('Trackline on the machine', () => {
    test('keeps a key the service knows as a secret, and refuses one it does not', async () => {
        const server = await createTestServer<TracklineServer>();

        expect(await server.call('account')).toEqual({ ok: true, value: null });
        expect(await server.call('issues')).toEqual({ ok: false, error: { code: 'failed', message: 'Connect your Trackline account first' } });
        expect(await server.call('connect', 'not a key')).toEqual({ ok: false, error: { code: 'failed', message: 'Trackline does not know this key' } });
        expect(server.secrets).toEqual({});

        expect(await server.call('connect', ` ${KEY} `)).toEqual({ ok: true, value: 'mira' });
        expect(server.secrets).toEqual({ key: KEY });
        expect(server.storage).toEqual({});
        expect(server.emitted).toEqual([{ name: 'issues.changed' }]);
    });

    test('gives a block in a chat the issues as rows, all of them or those in one state, and says so without a key', async () => {
        const server = await connected();
        const source = server.uiSource('issues');

        expect(source.name).toBe('dev.trackline/issues');
        expect(source.description).toBe('The issues of the Trackline account: key, title, state, assignee and labels');
        expect(source.parameters).toEqual({ type: 'object', properties: { state: { enum: ['open', 'closed'] } } });
        expect(await source.read({ state: 'closed' })).toEqual([
            { key: 'TRK-98', title: expect.any(String), state: 'closed', assignee: expect.any(String), labels: expect.any(String) }
        ]);
        expect(((await source.read()) as unknown[]).length).toBe(4);
        await expect((await createTestServer<TracklineServer>()).uiSource('issues').read()).rejects.toThrow('Connect your Trackline account first');
    });

    test('lists the issues of the account with the chat a person started on each', async () => {
        const server = await connected();

        await server.call('assign', 'TRK-101', 'chat-1');

        const issues = await server.call('issues');

        expect(issues.ok && issues.value.map((issue) => [issue.key, issue.state, issue.chat])).toEqual([
            ['TRK-101', 'open', 'chat-1'],
            ['TRK-102', 'open', null],
            ['TRK-103', 'open', null],
            ['TRK-98', 'closed', null]
        ]);
        expect(server.storage).toEqual({ chats: { 'TRK-101': 'chat-1' } });
    });

    test('marks an issue as worked on while its chat runs, only with chats.read', async () => {
        const chat = { id: 'chat-1', provider: 'claude', status: 'running' as const, model: null, cwd: '/work' };
        const working = async (server: Awaited<ReturnType<typeof connected>>) => {
            const issues = await server.call('issues');

            return issues.ok && issues.value[0]?.working;
        };
        const allowed = await connected({ storage: { chats: { 'TRK-101': 'chat-1' } } });
        const refused = await connected({ storage: { chats: { 'TRK-101': 'chat-1' } }, manifest: { permissions: WITHOUT_CHATS } });

        allowed.fire('chat.status', { chat });
        refused.fire('chat.status', { chat });

        expect(await working(allowed)).toBe(true);
        expect(await working(refused)).toBe(false);

        allowed.fire('chat.status', { chat: { ...chat, status: 'idle' } });

        expect(await working(allowed)).toBe(false);
        expect(allowed.emitted).toEqual([{ name: 'issues.changed' }, { name: 'issues.changed' }]);
    });

    test('gives an agent an issue with its changes and checks, along a line and through its tool', async () => {
        const server = await connected();
        const text = [
            'TRK-101: Sign-in loops back to the start',
            'State: open. Assigned to mira. Labels: bug, auth.',
            '',
            'After the second factor the page returns to the sign-in form. It happens when the session cookie is older than a day.',
            '',
            'Changes:',
            '- C-41 Renew the session before the second factor (open, branch fix/sign-in-loop): Tests failed, Lint passed'
        ].join('\n');

        expect(await server.nodeContext('issue', { key: 'TRK-101' })).toEqual([{ text }]);
        expect(await server.tool('issue').run({ key: 'trk-101' })).toBe(text);
        expect(await server.nodeContext('issue', { key: 'TRK-7' })).toEqual([{ text: 'Trackline has no issue TRK-7' }]);
        expect(await (await createTestServer<TracklineServer>()).nodeContext('issue', { key: 'TRK-101' })).toEqual([
            { text: 'Connect your Trackline account first' }
        ]);
    });

    test('checks the account every five minutes, and says nothing while no key is kept', async () => {
        const server = await connected();
        const unconnected = await createTestServer<TracklineServer>();

        await server.clock.advance('4m');

        expect(server.emitted).toEqual([]);

        await server.clock.advance('6m');
        await unconnected.clock.advance('10m');

        expect(server.emitted).toEqual([
            { name: 'issues.changed', payload: { open: 3 } },
            { name: 'issues.changed', payload: { open: 3 } }
        ]);
        expect(server.logs).toEqual(['Trackline has 3 open issues', 'Trackline has 3 open issues']);
        expect(unconnected.emitted).toEqual([]);
    });

    test('forgets the key when a person disconnects', async () => {
        const server = await connected();

        await server.call('disconnect');

        expect(await server.call('account')).toEqual({ ok: true, value: null });
        expect(server.secrets).toEqual({ key: '' });
    });
});
