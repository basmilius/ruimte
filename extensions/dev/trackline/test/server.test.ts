import { describe, expect, test } from 'bun:test';
import { checkHostProvider, createTestServer } from '@ruimte/extension/testing';
import type { TracklineServer } from '../server';

const KEY = 'trk_demo1234';
const WITHOUT_CHATS = { 'agents.tools': 'Looks up', clock: 'Checks', 'hosts.provide': 'Shows issues' };
const REMOTE = 'git@trackline.test:acme/shop.git';

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

describe('Trackline as a host provider', () => {
    test('keeps to what Ruimte asks of every provider, as a tracker and as the code host of its own remote', async () => {
        const server = await connected();

        await checkHostProvider(server.hostProvider('trackline'));
        await checkHostProvider(server.hostProvider('trackline-code'), { scope: { remote: REMOTE } });
        expect(server.logs).toEqual([]);
    });

    test('is a tracker everywhere and a code host only for a repository on trackline.test', async () => {
        const server = await connected();
        const tracker = server.hostProvider('trackline');
        const code = server.hostProvider('trackline-code');

        expect([tracker.kind, code.kind]).toEqual(['tracker', 'code-host']);
        expect(await tracker.match(REMOTE)).toBe(false);
        expect(await code.match(REMOTE)).toBe(true);
        expect(await code.match('https://trackline.test/acme/shop.git')).toBe(true);
        expect(await code.match('https://example.com/trackline.test.git')).toBe(false);
    });

    test('says it is signed out until an account is connected, in words a person can act on', async () => {
        const server = await createTestServer<TracklineServer>();

        expect(await server.hostProvider('trackline').status()).toEqual({
            state: 'signed-out',
            reason: 'Connect your Trackline account first, with Connect Trackline in the command palette.'
        });
        expect(await (await connected()).hostProvider('trackline').status()).toEqual({ state: 'ready', account: 'mira' });
        await expect(server.hostProvider('trackline').issues()).rejects.toThrow('Connect your Trackline account first');
    });

    test('lists the open issues by page, those of the account alone and those a search names', async () => {
        const tracker = (await connected()).hostProvider('trackline');
        const first = await tracker.issues();
        const assigned = await tracker.issues({ assigned: true, state: 'all' });

        expect(first.issues.map((issue) => [issue.ref, issue.state, issue.assignees, issue.commentCount])).toEqual([
            ['trackline:TRK-101', 'open', ['mira'], 2],
            ['trackline:TRK-102', 'open', ['joss'], 0],
            ['trackline:TRK-103', 'open', ['mira'], 1]
        ]);
        expect(first.cursor).toBeUndefined();
        expect(assigned.issues.map((issue) => issue.ref)).toEqual(['trackline:TRK-101', 'trackline:TRK-103', 'trackline:TRK-98']);
        expect((await tracker.issues({ state: 'all' })).cursor).toBe('3');
        expect((await tracker.issues({ state: 'all', cursor: '3' })).issues.map((issue) => issue.ref)).toEqual(['trackline:TRK-98']);
        expect((await tracker.issues({ query: 'search' })).issues.map((issue) => issue.ref)).toEqual(['trackline:TRK-103']);
    });

    test('reads an issue with its comments and the changes that close it, by its key or its address', async () => {
        const tracker = (await connected()).hostProvider('trackline');
        const issue = await tracker.issue('TRK-101');

        expect(issue).toMatchObject({
            ref: 'trackline:TRK-101',
            title: 'Sign-in loops back to the start',
            url: 'https://trackline.test/issues/TRK-101',
            labels: ['bug', 'auth'],
            comments: [
                { id: 'N-1', author: 'joss' },
                { id: 'N-2', author: 'mira', createdAt: '2026-11-02T10:02:00Z' }
            ],
            changes: [{ ref: 'trackline:C-41', state: 'open', branch: 'fix/sign-in-loop', checkState: 'failure' }]
        });
        expect(await tracker.parse('https://trackline.test/issues/trk-101')).toBe('TRK-101');
        expect(await tracker.parse('trk-98')).toBe('TRK-98');
        expect(await tracker.parse('#12')).toBeNull();
    });

    test('reads a change with its checks, its open review thread and the issue it closes, and finds it from its branch', async () => {
        const code = (await connected()).hostProvider('trackline-code');
        const change = await code.change('C-41', { remote: REMOTE });

        expect(change).toMatchObject({
            ref: 'trackline-code:C-41',
            state: 'open',
            headSha: '4f1c2aa9d0e3b7c6a5f4e3d2c1b0a9f8e7d6c5b4',
            checkState: 'failure',
            checks: [
                { name: 'Tests', state: 'failure' },
                { name: 'Lint', state: 'success' }
            ],
            threads: [{ id: 'R-7', author: 'joss', path: 'src/session.ts', line: 48 }],
            size: { additions: 42, deletions: 7, files: 3 },
            closes: ['trackline-code:TRK-101']
        });
        expect(await code.changeOfBranch('fix/sign-in-loop')).toBe('C-41');
        // A merged change is no longer the change of its branch.
        expect(await code.changeOfBranch('fix/time-zone')).toBeNull();
        expect((await code.changes({ state: 'merged' })).changes.map((merged) => [merged.ref, merged.checkState])).toEqual([
            ['trackline-code:C-35', 'success']
        ]);
    });

    test('gives the log of a check by its name, and none for a check the change does not have', async () => {
        const code = (await connected()).hostProvider('trackline-code');

        expect(await code.checkLog('C-41', 'Tests')).toEqual({
            text: 'Running 212 tests\nsession.test.ts: renews before the second factor\n  expected 1 cookie, got 2\n211 passed, 1 failed',
            truncated: false
        });
        expect(await code.checkLog('C-41', 'Deploy')).toBeNull();
    });
});
