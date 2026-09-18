import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, RpcFailure, startDaemon } from './wire-client';

test('a failed durable start reaches neither provider and the next send recovers without clear', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-disk-failure-'));
    const bin = join(temporary, 'bin');
    const log = join(temporary, 'provider.jsonl');
    await mkdir(bin);
    await writeFile(log, '');
    await installLoggedProviders(bin, log);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}`, FIXTURE_INPUT: log } });
    const client = await daemon.connect();

    try {
        for (const provider of ['claude', 'codex'] as const) {
            const chatId = `disk-${provider}`;
            await client.call('chat.create', { chatId, provider, cwd: daemon.home });
            const chats = join(daemon.home, 'chats');
            const saved = join(daemon.home, `chats-${provider}`);
            await withOwnedDaemonPaused(daemon.child, async () => {
                await mkdir(chats, { recursive: true });
                await rename(chats, saved);
                await writeFile(chats, 'storage unavailable');
            });
            try {
                const before = (await readFile(log, 'utf8')).length;
                let failure: RpcFailure | null = null;
                try {
                    await client.call('chat.send', { chatId, text: 'do not deliver' });
                } catch (error) {
                    failure = error as RpcFailure;
                }
                expect(failure?.error.code).toBe('chat-storage');
                await Bun.sleep(200);
                const attempted = parseLog((await readFile(log, 'utf8')).slice(before)).filter(isProviderInput);
                expect(attempted).toEqual([]);
            } finally {
                await withOwnedDaemonPaused(daemon.child, async () => {
                    await rm(chats);
                    await rename(saved, chats);
                });
            }

            await client.call('chat.send', { chatId, text: 'recovered' });
            const recovered = await waitForIdle(client, chatId);
            expect(recovered.items.filter((item: any) => item.kind === 'user').at(-1)?.text).toBe('recovered');
            expect(recovered.items.some((item: any) => item.kind === 'assistant')).toBe(true);
            await client.call('chat.kill', { chatId });
        }
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('attach since returns only a complete retained tail and otherwise falls back to a snapshot', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-replay-'));
    const bin = join(temporary, 'bin');
    await mkdir(bin);
    await installSimpleProviders(bin);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}` } });
    const client = await daemon.connect();

    try {
        const chatId = 'replay-claude';
        await client.call('chat.create', { chatId, provider: 'claude', cwd: daemon.home });
        for (let index = 0; index < 10; index += 1) {
            await client.call('chat.send', { chatId, text: `message ${index}` });
            await waitForIdle(client, chatId);
        }

        const compacted = await client.call('chat.attach', { chatId, since: 0 });
        expect('events' in compacted).toBe(false);
        expect(compacted.items.length).toBeGreaterThan(0);
        const retainedFrom = compacted.seq;

        const current = await client.call('chat.attach', { chatId, since: retainedFrom });
        expect(current.items).toEqual([]);
        expect(current.events).toEqual([]);
        expect(current.seq).toBe(retainedFrom);

        await client.call('chat.send', { chatId, text: 'retained tail' });
        await waitForIdle(client, chatId);
        const tail = await client.call('chat.attach', { chatId, since: retainedFrom });
        expect(tail.items).toEqual([]);
        expect(tail.events.length).toBeGreaterThan(0);
        expect(tail.seq).toBeGreaterThan(retainedFrom);
        const ordinary = await client.call('chat.attach', { chatId });
        expect(applyEvents(compacted, tail.events)).toEqual({ info: ordinary.info, items: ordinary.items });

        const future = await client.call('chat.attach', { chatId, since: tail.seq + 100 });
        expect('events' in future).toBe(false);
        expect(future.items).toEqual(ordinary.items);
        expect('history' in future).toBe(false);

        const beforeReset = tail.seq;
        await client.call('chat.clear', { chatId });
        const resetFallback = await client.call('chat.attach', { chatId, since: beforeReset });
        expect('events' in resetFallback).toBe(false);
        expect(resetFallback.items).toEqual([]);
        const resetCurrent = await client.call('chat.attach', { chatId, since: resetFallback.seq });
        expect(resetCurrent.events).toEqual([]);
        expect(resetCurrent.items).toEqual([]);
        expect(client.violations).toEqual([]);
        await client.call('chat.kill', { chatId });
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('a completed transcript survives an abrupt owned-daemon restart', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-abrupt-restart-'));
    const home = join(temporary, 'home');
    const bin = join(temporary, 'bin');
    await mkdir(home);
    await mkdir(bin);
    await installSimpleProviders(bin);
    const environment = { PATH: `${bin}:${process.env.PATH}` };
    let daemon = await startDaemon({ home, env: environment });
    let client = await daemon.connect();

    try {
        const chatId = 'durable-claude';
        await client.call('chat.create', { chatId, provider: 'claude', cwd: home });
        await client.call('chat.send', { chatId, text: 'persist me' });
        const completed = await waitForIdle(client, chatId);
        const expected = completed.items.map(stableItem);
        expect(expected.some((item: any) => item.kind === 'assistant' && item.text === 'echo: persist me')).toBe(true);

        client.close();
        daemon.child.kill('SIGKILL');
        await daemon.child.exited;

        daemon = await startDaemon({ home, env: environment });
        client = await daemon.connect();
        await client.call('chat.create', { chatId });
        const restored = await client.call('chat.attach', { chatId });
        expect(restored.items.map(stableItem)).toEqual(expected);
        expect(restored.info.activeTurnId).toBeNull();
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 45_000);

const installLoggedProviders = async (bin: string, log: string): Promise<void> => {
    for (const provider of ['claude', 'codex'] as const) {
        const driver = join(bin, `${provider}.ts`);
        const factory = provider === 'claude' ? 'fakeClaude' : 'fakeCodex';
        await writeFile(
            driver,
            `import { ${factory} } from '${join(repositoryRoot, `apps/server-rust/tests/providers/fake-${provider}.ts`)}';
import { runOverStdio } from '${join(repositoryRoot, 'apps/server-rust/tests/providers/fake-cli.ts')}';
import { appendFileSync } from 'node:fs';
const record = (value) => appendFileSync(process.env.FIXTURE_INPUT, JSON.stringify(value) + '\\n');
await runOverStdio((io) => {
    record({ provider: '${provider}', kind: 'launch', argv: io.argv });
    const fake = ${factory}(io);
    return { onLine(line) { record({ provider: '${provider}', kind: 'input', frame: JSON.parse(line) }); fake.onLine(line); } };
});
`
        );
        await installExecutable(bin, provider, `exec '${process.execPath}' '${driver}' "$@"`);
    }
    await writeFile(log, '');
};

const installSimpleProviders = async (bin: string): Promise<void> => {
    for (const provider of ['claude', 'codex'] as const) {
        await installExecutable(
            bin,
            provider,
            `exec '${process.execPath}' '${join(repositoryRoot, `apps/server-rust/tests/providers/fake-${provider}.ts`)}' "$@"`
        );
    }
};

const installExecutable = async (bin: string, name: string, command: string): Promise<void> => {
    const executable = join(bin, name);
    await writeFile(
        executable,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'fixture 1.0.0'; exit 0; fi
${command}
`
    );
    await chmod(executable, 0o755);
};

const parseLog = (text: string): any[] =>
    text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

const isProviderInput = (entry: any): boolean => entry.frame?.type === 'user' || entry.frame?.method === 'turn/start';

const withOwnedDaemonPaused = async (child: { pid: number }, mutate: () => Promise<void>): Promise<void> => {
    const before = await processStatus(child.pid);
    // Only signal the direct child this test spawned; a stale or unrelated PID fails closed.
    if (!before || before.parentPid !== process.pid) {
        throw new Error(`Refusing to suspend process ${child.pid}: it is not the owned daemon`);
    }
    process.kill(child.pid, 'SIGSTOP');
    try {
        await waitForProcessState(child.pid, (state) => state.startsWith('T'), 'stop');
        await mutate();
    } finally {
        process.kill(child.pid, 'SIGCONT');
        await waitForProcessState(child.pid, (state) => !state.startsWith('T'), 'continue');
    }
};

const processStatus = async (pid: number): Promise<{ parentPid: number; state: string } | null> => {
    const ps = Bun.spawn(['/bin/ps', '-o', 'ppid=', '-o', 'state=', '-p', String(pid)], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore'
    });
    const output = await new Response(ps.stdout).text();
    if ((await ps.exited) !== 0) {
        return null;
    }
    const [parentPid, state] = output.trim().split(/\s+/, 2);
    return parentPid && state ? { parentPid: Number(parentPid), state } : null;
};

const waitForProcessState = async (pid: number, matches: (state: string) => boolean, expected: string): Promise<void> => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const status = await processStatus(pid);
        if (!status) {
            throw new Error(`Owned daemon ${pid} exited while waiting for it to ${expected}`);
        }
        if (matches(status.state)) {
            return;
        }
        await Bun.sleep(10);
    }
    throw new Error(`Owned daemon ${pid} did not ${expected}`);
};

const stableItem = (item: any): any => {
    const { createdAt: _createdAt, endedAt: _endedAt, finishedAt: _finishedAt, startedAt: _startedAt, ...stable } = item;
    return stable;
};

const applyEvents = (snapshot: any, events: any[]): { info: any; items: any[] } => {
    let info = structuredClone(snapshot.info);
    let items = structuredClone(snapshot.items);
    for (const event of events) {
        if (event.type === 'reset') {
            info = structuredClone(event.info);
            items = structuredClone(event.items);
        } else if (event.type === 'info') {
            info = structuredClone(event.info);
        } else if (event.type === 'item') {
            const current = items.findIndex((item: any) => item.id === event.item.id);
            if (current >= 0) {
                items[current] = structuredClone(event.item);
            } else if (typeof event.historyIndex === 'number') {
                items.splice(event.historyIndex, 0, structuredClone(event.item));
            } else {
                items.push(structuredClone(event.item));
            }
        } else if (event.type === 'delta') {
            const item = items.find((candidate: any) => candidate.id === event.itemId);
            if (item) {
                item.text = `${item.text ?? ''}${event.text}`;
            }
        }
    }
    return { info, items };
};

const waitForIdle = (client: any, chatId: string): Promise<any> =>
    waitFor(async () => {
        const attached = await client.call('chat.attach', { chatId });
        const complete = attached.items.some((item: any) => item.kind === 'assistant' && item.streaming !== true);
        return attached.info.activeTurnId === null && complete ? attached : null;
    });

const waitFor = async <T>(read: () => Promise<T | null | false>): Promise<T> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) {
            return value;
        }
        await Bun.sleep(30);
    }
    throw new Error('Condition timed out');
};
