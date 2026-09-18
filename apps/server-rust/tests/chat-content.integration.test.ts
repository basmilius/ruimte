import { expect, test } from 'bun:test';
import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, RpcFailure, startDaemon } from './wire-client';

test('queued turns can be removed, promoted and force-cleared for both providers', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-content-'));
    const bin = join(temporary, 'bin');
    await mkdir(bin);
    await installSimpleProviders(bin);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}` } });
    const client = await daemon.connect();

    try {
        for (const provider of ['claude', 'codex'] as const) {
            const chatId = `queue-${provider}`;
            await client.call('chat.create', { chatId, provider, cwd: daemon.home, runtimeMode: 'supervised' });
            await client.call('chat.send', { chatId, text: 'slow' });
            await waitForActive(client, chatId);
            await client.call('chat.send', { chatId, text: 'keep first' });
            await client.call('chat.send', { chatId, text: 'drop second' });

            const queued = await client.call('chat.attach', { chatId });
            expect(queued.info.queue.map((message: any) => message.text)).toEqual(['keep first', 'drop second']);
            await client.call('chat.unqueue', { chatId, messageId: queued.info.queue[1].id });
            await client.call('chat.sendNow', { chatId, messageId: queued.info.queue[0].id });

            const finished = await waitForIdle(client, chatId);
            const userMessages = finished.items.filter((item: any) => item.kind === 'user').map((item: any) => item.text);
            expect(userMessages).toEqual(['slow', 'keep first']);
            expect(finished.info.queue).toEqual([]);

            await client.call('chat.send', { chatId, text: 'slow' });
            await waitForActive(client, chatId);
            let busy: RpcFailure | null = null;
            try {
                await client.call('chat.clear', { chatId });
            } catch (error) {
                busy = error as RpcFailure;
            }
            expect(busy?.error.code).toBe('chat-busy');
            await client.call('chat.clear', { chatId, force: true });
            const cleared = await client.call('chat.attach', { chatId });
            expect(cleared.items).toEqual([]);
            expect(cleared.info.queue).toEqual([]);
            expect(cleared.info.activeTurnId).toBeNull();
            await client.call('chat.kill', { chatId });
        }
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('Claude prompt framing keeps effort first, attachments with the message and the last skill last', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-prompt-'));
    const bin = join(temporary, 'bin');
    const log = join(temporary, 'provider.jsonl');
    await mkdir(bin);
    await writeFile(log, '');
    await installLoggedClaude(bin, log);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}`, FIXTURE_INPUT: log } });
    const client = await daemon.connect();

    try {
        const chatId = 'prompt-claude';
        await client.call('chat.create', {
            chatId,
            provider: 'claude',
            cwd: daemon.home,
            runtimeMode: 'supervised',
            selection: { model: 'claude-sonnet-5', options: { effort: 'ultrathink', contextWindow: '200k' } }
        });
        await client.call('chat.send', {
            chatId,
            text: 'Use $alpha first and $beta finish this',
            skills: ['alpha', 'beta'],
            mentions: [],
            attachments: [{ name: 'note.txt', mime: 'text/plain', data: Buffer.from('attached').toString('base64') }]
        });
        await waitForIdle(client, chatId);

        const captured = await waitFor(async () => {
            const entries = (await readFile(log, 'utf8'))
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            return entries.find((entry) => entry.kind === 'input' && entry.frame.type === 'user') ?? null;
        });
        const content = captured.frame.message.content;
        expect(content).toHaveLength(2);
        expect(content[0].text).toStartWith('ultrathink\n\nUse /alpha first and\n\nAttached files:\n- ');
        expect(content[0].text).toContain('(note.txt)');
        expect(content[1]).toEqual({ type: 'text', text: '/beta finish this' });
        expect(client.violations).toEqual([]);
        await client.call('chat.kill', { chatId });
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 45_000);

test('Claude subagent pages retain source data and watches belong to one client', async () => {
    const fixture = await createSubagentFixture(false);
    const daemon = await startDaemon({ home: fixture.home });
    const client = await daemon.connect();
    const other = await daemon.connect();

    try {
        await client.call('chat.create', { chatId: fixture.chatId });
        const page = await client.call('chat.subagent', {
            chatId: fixture.chatId,
            toolUseId: fixture.toolUseId,
            limit: 3,
            watch: true
        });
        expect(page.source).toBe('claude-transcript');
        expect(page.history.start).toBe(2);
        expect(page.items.map((item: any) => item.createdAt)).toEqual([1789549102400, 1789549104000, 1789549125000]);
        const older = await client.call('chat.subagent', {
            chatId: fixture.chatId,
            toolUseId: fixture.toolUseId,
            limit: 3,
            cursor: page.history.cursor
        });
        expect(older.history).toEqual({ start: 0, cursor: null });
        expect(older.items.map((item: any) => item.createdAt)).toEqual([1789549100551, 1789549102344]);

        const attached = await client.call('chat.attach', { chatId: fixture.chatId });
        expect(attached.items[0].native).toEqual({ agentId: 'a4c2e8f10b3d5a7e9' });
        const clientStart = client.frames.length;
        const otherStart = other.frames.length;
        await fixture.append(1);
        await waitFor(() => Promise.resolve(client.frames.slice(clientStart).some((frame: any) => frame.event === 'chat.subagentChanged') ? true : null));
        expect(other.frames.slice(otherStart).filter((frame: any) => frame.event === 'chat.subagentChanged')).toEqual([]);

        const latest = await client.call('chat.subagent', {
            chatId: fixture.chatId,
            toolUseId: fixture.toolUseId,
            limit: 3,
            watch: false
        });
        expect(latest.items.at(-1)?.text).toBe('Wire appended 1');
        const releasedAt = client.frames.length;
        await fixture.append(2);
        await Bun.sleep(1_200);
        expect(client.frames.slice(releasedAt).filter((frame: any) => frame.event === 'chat.subagentChanged')).toEqual([]);
        expect(client.violations).toEqual([]);
        expect(other.violations).toEqual([]);
    } finally {
        client.close();
        other.close();
        await daemon.stop();
        await rm(fixture.home, { recursive: true, force: true });
    }
}, 45_000);

test('loading a stored background subagent settles it from a complete transcript', async () => {
    const fixture = await createSubagentFixture(true);
    const daemon = await startDaemon({ home: fixture.home });
    const client = await daemon.connect();

    try {
        await client.call('chat.create', { chatId: fixture.chatId });
        const attached = await client.call('chat.attach', { chatId: fixture.chatId });
        const subagent = attached.items[0];
        expect(subagent.status).toBe('done');
        expect(subagent.finishedAt).toBe(1789549125000);
        expect(subagent.result).toBe('The docs have a README and the decisions; a guide for contributors is missing.');
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(fixture.home, { recursive: true, force: true });
    }
}, 30_000);

const installSimpleProviders = async (bin: string): Promise<void> => {
    for (const provider of ['claude', 'codex'] as const) {
        await installExecutable(
            bin,
            provider,
            `exec '${process.execPath}' '${join(repositoryRoot, `apps/server-rust/tests/providers/fake-${provider}.ts`)}' "$@"`
        );
    }
};

const installLoggedClaude = async (bin: string, log: string): Promise<void> => {
    const driver = join(bin, 'claude.ts');
    await writeFile(
        driver,
        `import { fakeClaude } from '${join(repositoryRoot, 'apps/server-rust/tests/providers/fake-claude.ts')}';
import { runOverStdio } from '${join(repositoryRoot, 'apps/server-rust/tests/providers/fake-cli.ts')}';
import { appendFileSync } from 'node:fs';
const record = (value) => appendFileSync(process.env.FIXTURE_INPUT, JSON.stringify(value) + '\\n');
await runOverStdio((io) => {
    record({ kind: 'launch', argv: io.argv });
    const fake = fakeClaude(io);
    return { onLine(line) { record({ kind: 'input', frame: JSON.parse(line) }); fake.onLine(line); } };
});
`
    );
    await installExecutable(bin, 'claude', `exec '${process.execPath}' '${driver}' "$@"`);
    await writeFile(log, '');
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

const createSubagentFixture = async (running: boolean) => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-subagent-content-'));
    const chatId = 'chat-sub';
    const toolUseId = 'toolu_01ParentAgentCall';
    const sessionId = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';
    await cp(join(repositoryRoot, 'apps/server-rust/tests/providers/fixtures/claude-projects'), join(home, 'claude/projects'), { recursive: true });
    const info = {
        chatId,
        provider: 'claude',
        cwd: home,
        agentSessionId: sessionId,
        model: null,
        selection: { model: 'claude-sonnet-5', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0, turns: 0 },
        createdAt: 0
    };
    const item = {
        id: `1:${toolUseId}`,
        kind: 'subagent',
        createdAt: 1,
        turnId: null,
        toolUseId,
        description: 'Survey the docs',
        subagentType: 'general-purpose',
        prompt: null,
        background: running,
        status: running ? 'running' : 'done',
        startedAt: 1,
        finishedAt: running ? null : 2,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    };
    await writeStoredChat(home, chatId, info, [item]);
    const transcript = join(home, 'claude/projects/-work-demo', sessionId, 'subagents/agent-a4c2e8f10b3d5a7e9.jsonl');
    const append = (index: number) =>
        appendFile(
            transcript,
            `${JSON.stringify({
                type: 'assistant',
                uuid: `wire-${index}`,
                isSidechain: true,
                sessionId,
                timestamp: new Date().toISOString(),
                message: {
                    id: `wiremsg-${index}`,
                    role: 'assistant',
                    content: [{ type: 'text', text: `Wire appended ${index}` }],
                    stop_reason: 'end_turn'
                }
            })}\n`
        );
    return { append, chatId, home, toolUseId };
};

const writeStoredChat = async (home: string, chatId: string, info: unknown, items: unknown[]): Promise<void> => {
    const directory = join(home, 'chats');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const path = join(directory, `${encodeURIComponent(chatId)}.json`);
    await writeFile(path, JSON.stringify({ info, items, seq: 0, resetSeq: 0, preambles: [], preambleOperations: [] }), { mode: 0o600 });
    await chmod(path, 0o600);
};

const waitForActive = (client: any, chatId: string): Promise<any> =>
    waitFor(async () => {
        const attached = await client.call('chat.attach', { chatId });
        return attached.info.activeTurnId === null ? null : attached;
    });

const waitForIdle = (client: any, chatId: string): Promise<any> =>
    waitFor(async () => {
        const attached = await client.call('chat.attach', { chatId });
        return attached.info.activeTurnId === null && (attached.info.queue ?? []).length === 0 ? attached : null;
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
