import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TerminalPrepareSource } from '@ruimte/contracts';
import { PrepareTerminal, type PrepareTerminalHost } from './prepare-terminal.ts';
import { makeHarness, type Harness } from './test-helpers.ts';
import type { ClientConnection } from '../dispatcher.ts';

let harness: Harness;
const client: ClientConnection = { id: 'reader', send() {} };
const source: TerminalPrepareSource = { chatId: 'chat', itemId: 'reply', language: 'bash', code: 'echo "hello"\n' };
let host: PrepareTerminalHost;
let prepare: PrepareTerminal;
let now = 0;
let inserted: string[];

function prompt(cwd = '/work'): void {
    harness.manager.get('shell')!.shellPrompt.connect({
        async inspect() {
            return { cwd, empty: inserted.length === 0 && harness.adapter.spawned[0]!.typed === '' };
        },
        async prepare(expected, command) {
            if (expected !== cwd || inserted.length || harness.adapter.spawned[0]!.typed !== '') {
                return 'refused';
            }
            inserted.push(command);
            return 'inserted';
        },
        close() {}
    });
}

async function preview() {
    return prepare.preview('owner', source, client);
}

async function token(): Promise<string> {
    return (await preview()).targets[0]!.token;
}

beforeEach(async () => {
    harness = await makeHarness();
    await harness.manager.create({ sessionId: 'shell', shell: '/bin/bash', args: [], cwd: '/work', cols: 80, rows: 24 });
    await harness.manager.attach('shell', client.id, 80, 24);
    harness.manager.holdsForeground = async () => true;
    now = 0;
    inserted = [];
    host = {
        machineId: 'owner',
        machine: 'Remote machine',
        sessions: harness.manager,
        source: () => ({ cwd: '/work', projectId: 'project' }),
        title: () => 'My terminal',
        syntax: async () => true,
        now: () => now
    };
    prepare = new PrepareTerminal(host);
    prompt();
});
afterEach(async () => await harness.cleanup());

describe('prepare terminal input', () => {
    test('preview writes nothing; confirmation pastes exact text without Enter once', async () => {
        const result = await preview();
        expect(result).toMatchObject({ command: 'echo "hello"', machine: 'Remote machine', machineId: 'owner', cwd: '/work' });
        expect(result.targets[0]).toMatchObject({ sessionId: 'shell', title: 'My terminal', cwd: '/work' });
        expect(harness.adapter.spawned[0]!.typed).toBe('');
        const chosen = result.targets[0]!.token;
        await prepare.prepare('owner', chosen, client);
        expect(harness.adapter.spawned[0]!.typed).toBe('');
        expect(inserted).toEqual(['echo "hello"']);
        await expect(prepare.prepare('owner', chosen, client)).rejects.toThrow();
        expect((await preview()).targets).toEqual([]);
    });

    test('never overwrites pending input, even before echo or when the user deletes it again', async () => {
        const chosen = await token();
        harness.manager.write('shell', 'typed\x7f', 'another-client');
        await expect(prepare.prepare('owner', chosen, client)).rejects.toThrow();
        expect(harness.adapter.spawned[0]!.typed).toBe('typed\x7f');
        expect((await preview()).targets).toEqual([]);
    });

    for (const foreground of [false, null]) {
        test(`refuses foreground=${foreground} both before and after preview`, async () => {
            const chosen = await token();
            harness.manager.holdsForeground = async () => foreground;
            expect((await preview()).targets).toEqual([]);
            await expect(prepare.prepare('owner', chosen, client)).rejects.toThrow();
            expect(harness.adapter.spawned[0]!.typed).toBe('');
        });
    }

    test('input arriving during the foreground check wins the race', async () => {
        const chosen = await token();
        harness.manager.holdsForeground = async () => {
            harness.manager.write('shell', 'mine');
            return true;
        };
        await expect(prepare.prepare('owner', chosen, client)).rejects.toThrow();
        expect(harness.adapter.spawned[0]!.typed).toBe('mine');
    });

    test('two simultaneous confirmations paste once', async () => {
        const chosen = await token();
        const results = await Promise.allSettled([prepare.prepare('owner', chosen, client), prepare.prepare('owner', chosen, client)]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(inserted).toHaveLength(1);
        expect(harness.adapter.spawned[0]!.typed).toBe('');
    });

    test('machine and client identity cannot be substituted', async () => {
        const chosen = await token();
        await expect(prepare.prepare('local', chosen, client)).rejects.toThrow();
        await expect(prepare.preview('local', source, client)).rejects.toThrow();
        await expect(prepare.prepare('owner', chosen, { ...client, id: 'other' })).rejects.toThrow();
        await prepare.prepare('owner', chosen, client);
        expect(inserted).toHaveLength(1);
        expect(harness.adapter.spawned[0]!.typed).toBe('');
    });

    for (const change of ['source', 'folder', 'project', 'exit', 'detach', 'editor', 'held', 'agent', 'expire', 'closed'] as const) {
        test(`revalidates ${change} after the async foreground read`, async () => {
            const chosen = await token();
            const connection = { ...client, closed: false };
            harness.manager.holdsForeground = async () => {
                const session = harness.manager.get('shell')!;
                switch (change) {
                    case 'source':
                        host.source = () => null;
                        break;
                    case 'folder':
                        host.source = () => ({ cwd: '/other', projectId: 'project' });
                        break;
                    case 'project':
                        host.title = () => null;
                        break;
                    case 'exit':
                        harness.adapter.spawned[0]!.exit(0);
                        break;
                    case 'detach':
                        harness.manager.detach('shell', client.id);
                        break;
                    case 'editor':
                        prompt();
                        break;
                    case 'held':
                        session.heldCommand = 'held command';
                        break;
                    case 'agent':
                        session.agent = { kind: 'claude', status: 'idle', live: false, agentSessionId: 'agent', transcriptPath: null, updatedAt: 0 };
                        break;
                    case 'expire':
                        now = 60_001;
                        break;
                    case 'closed':
                        connection.closed = true;
                        break;
                }
                return true;
            };
            await expect(prepare.prepare('owner', chosen, connection)).rejects.toThrow();
            expect(harness.adapter.spawned[0]!.typed).toBe('');
        });
    }

    test('a restarted session with the same id cannot receive a stale preview', async () => {
        const chosen = await token();
        await harness.manager.kill('shell');
        await harness.manager.create({ sessionId: 'shell', shell: '/bin/bash', args: [], cwd: '/work', cols: 80, rows: 24 });
        await expect(prepare.prepare('owner', chosen, client)).rejects.toThrow();
        expect(harness.adapter.spawned[1]!.typed).toBe('');
    });

    test('refuses unknown input state, wrong cwd, stale source and invalid shell syntax', async () => {
        prompt('/elsewhere');
        expect((await preview()).targets).toEqual([]);
        harness.manager.get('shell')!.shellPrompt.dispose();
        expect((await preview()).targets).toEqual([]);
        host.syntax = async () => false;
        await expect(preview()).rejects.toThrow();
        host.syntax = async () => true;
        host.source = () => null;
        await expect(preview()).rejects.toThrow();
        expect(harness.adapter.spawned[0]!.typed).toBe('');
    });
});
