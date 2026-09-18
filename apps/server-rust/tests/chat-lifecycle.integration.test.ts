import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, RpcFailure, startDaemon } from './wire-client';

test('chat configuration keeps provider sessions while applying new runtime flags', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-configure-'));
    const bin = join(temporary, 'bin');
    const log = join(temporary, 'provider.jsonl');
    await mkdir(bin);
    await writeFile(log, '');
    await installLoggedProviders(bin, log);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}`, FIXTURE_INPUT: log } });
    const client = await daemon.connect();

    try {
        for (const provider of ['claude', 'codex'] as const) {
            const chatId = `configure-${provider}`;
            const created = await client.call('chat.create', {
                chatId,
                provider,
                cwd: daemon.home,
                runtimeMode: 'supervised'
            });
            const first = await sendAndWait(client, chatId, 'first');
            const selection = { ...created.selection, options: { ...created.selection.options, effort: 'low' } };
            const configured = await client.call('chat.configure', { chatId, selection, runtimeMode: 'full-access' });
            const second = await sendAndWait(client, chatId, 'second');

            expect(second.info.agentSessionId).toBe(first.info.agentSessionId);
            expect(configured.runtimeMode).toBe('full-access');
            expect(configured.selection.options.effort).toBe('low');
            if (provider === 'codex') {
                expect(second.items.filter((item: any) => item.kind === 'assistant').at(-1)?.text).toContain('low');
            }
            await client.call('chat.kill', { chatId });
        }

        const captured = (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        const resumedClaude = captured.find((entry) => entry.provider === 'claude' && entry.kind === 'launch' && entry.argv.includes('--resume'));
        expect(resumedClaude.argv).toContain('--allow-dangerously-skip-permissions');
        expect(resumedClaude.argv.slice(resumedClaude.argv.indexOf('--effort'), resumedClaude.argv.indexOf('--effort') + 2)).toEqual(['--effort', 'low']);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

test('history pagination, detach, compaction and async dismissal preserve lifecycle state', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-misc-'));
    const bin = join(temporary, 'bin');
    await mkdir(bin);
    await installSimpleProviders(bin);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}` } });
    const client = await daemon.connect();
    const other = await daemon.connect();

    try {
        for (const provider of ['claude', 'codex'] as const) {
            const chatId = `misc-${provider}`;
            await client.call('chat.create', { chatId, provider, cwd: daemon.home, runtimeMode: 'supervised' });
            for (let index = 0; index < 4; index += 1) {
                await sendAndWait(client, chatId, `hello ${index}`);
            }
            const full = await client.call('chat.attach', { chatId });
            let page = await client.call('chat.attach', { chatId, historyLimit: 3 });
            let items = [...page.items];
            while (page.history.cursor) {
                page = await client.call('chat.history', { chatId, cursor: page.history.cursor, limit: 3 });
                items = [...page.items, ...items];
            }
            expect(items).toEqual(full.items);

            await client.call('chat.detach', { chatId });
            const frameStart = client.frames.length;
            await sendAndWait(other, chatId, 'detached');
            expect(client.frames.slice(frameStart).filter((frame: any) => frame.event === 'chat.event' && frame.payload.chatId === chatId)).toHaveLength(0);

            await client.call('chat.attach', { chatId });
            await client.call('chat.compact', { chatId });
            const compacted = await waitFor(async () => {
                const attached = await client.call('chat.attach', { chatId });
                return attached.info.activeTurnId === null ? attached : null;
            });
            expect(compacted.items.some((item: any) => item.kind === 'compaction' || (item.kind === 'user' && item.text === '/compact'))).toBe(true);

            if (provider === 'codex') {
                await client.call('chat.send', { chatId, text: 'async: Which color?' });
                const pending = await waitFor(async () => {
                    const attached = await client.call('chat.attach', { chatId });
                    return attached.items.find((item: any) => item.kind === 'question' && item.state === 'pending') ?? null;
                });
                await client.call('chat.dismiss', { chatId, itemId: pending.id });
                const dismissed = await client.call('chat.attach', { chatId });
                expect(dismissed.items.find((item: any) => item.id === pending.id)?.state).toBe('dismissed');
                let repeated: RpcFailure | null = null;
                try {
                    await client.call('chat.dismiss', { chatId, itemId: pending.id });
                } catch (error) {
                    repeated = error as RpcFailure;
                }
                expect(repeated?.error.code).toBe('request-not-found');
                await client.call('chat.cancel', { chatId });
            }
            await client.call('chat.kill', { chatId });
        }
        expect(client.violations).toEqual([]);
        expect(other.violations).toEqual([]);
    } finally {
        client.close();
        other.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 90_000);

test('terminal agents restore their mode and model without starting until resumed', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'ruimte-session-resume-'));
    const bin = join(fixture, 'bin');
    await mkdir(bin);
    await installResumeProviders(bin);

    try {
        for (const provider of ['claude', 'codex'] as const) {
            const home = join(fixture, provider);
            const log = join(home, 'launches.jsonl');
            await mkdir(home);
            await writeFile(log, '');
            const environment = { PATH: `${bin}:${process.env.PATH}`, FIXTURE_LOG: log };
            const payload = {
                sessionId: `resume-${provider}`,
                shell: '/bin/sh',
                cwd: home,
                cols: 80,
                rows: 24,
                agent: {
                    kind: provider,
                    runtimeMode: 'auto-accept-edits',
                    model: provider === 'claude' ? 'claude-opus-5' : 'gpt-6-astra'
                }
            };
            let daemon = await startDaemon({ home, env: environment });
            let client = await daemon.connect();
            await client.call('session.create', payload);
            const launch = await waitFor(async () => (await providerLaunches(log))[0] ?? null);
            const transcript = join(home, 'transcript.jsonl');
            await writeFile(transcript, '{}\n');
            const hook = await fetch(`${daemon.base}/hooks/${provider}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${launch.hook}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    hook_event_name: 'UserPromptSubmit',
                    session_id: `${provider}-recorded`,
                    transcript_path: provider === 'claude' ? transcript : undefined
                })
            });
            expect(hook.status).toBeLessThan(300);
            await waitFor(async () => {
                const listed = await client.call('session.list', {});
                return listed.sessions[0]?.agent?.agentSessionId === `${provider}-recorded` ? true : null;
            });
            client.close();
            await daemon.stop();

            await writeFile(log, '');
            daemon = await startDaemon({ home, env: environment });
            client = await daemon.connect();
            const restored = await client.call('session.create', payload);
            await Bun.sleep(200);
            expect(await providerLaunches(log)).toHaveLength(0);
            expect(restored.agent.runtimeMode).toBe('auto-accept-edits');
            expect(restored.agent.agentSessionId).toBe(`${provider}-recorded`);
            await client.call('agent.resume', { sessionId: payload.sessionId });
            const resumed = await waitFor(async () => (await providerLaunches(log))[0] ?? null);
            expect(resumed.args).toContain(payload.agent.model);
            expect(resumed.args).toContain(provider === 'claude' ? 'acceptEdits' : 'workspace-write');
            expect(resumed.args).toContain(`${provider}-recorded`);
            expect(client.violations).toEqual([]);
            client.close();
            await daemon.stop();
        }
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
}, 90_000);

test('Claude transcript titles and Codex one-shot titles become backend names', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-title-'));
    const bin = join(temporary, 'bin');
    await mkdir(bin);
    await installTitleProviders(bin);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH}` } });
    const client = await daemon.connect();

    try {
        await client.call('chat.create', { chatId: 'title-claude', provider: 'claude', cwd: daemon.home });
        const claude = await sendAndWait(client, 'title-claude', 'first');
        const transcriptDirectory = join(daemon.home, 'claude', 'projects', daemon.home.replace(/[^a-zA-Z0-9]/g, '-'));
        await mkdir(transcriptDirectory, { recursive: true });
        await writeFile(
            join(transcriptDirectory, `${claude.info.agentSessionId}.jsonl`),
            `${JSON.stringify({ type: 'ai-title', aiTitle: 'Wire Claude Title', sessionId: claude.info.agentSessionId })}\n`
        );
        const titledClaude = await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'title-claude' });
            return attached.info.suggestedTitle === 'Wire Claude Title' ? attached : null;
        });
        expect(titledClaude.info.suggestedTitle).toBe('Wire Claude Title');

        await client.call('chat.create', { chatId: 'title-codex', provider: 'codex', cwd: daemon.home });
        await sendAndWait(client, 'title-codex', 'first');
        const titledCodex = await waitFor(async () => {
            const attached = await client.call('chat.attach', { chatId: 'title-codex' });
            return attached.info.suggestedTitle === 'Wire Codex Title' ? attached : null;
        });
        expect(titledCodex.info.suggestedTitle).toBe('Wire Codex Title');
        const named = await sendAndWait(client, 'title-codex', 'name?');
        expect(named.items.filter((item: any) => item.kind === 'assistant').at(-1)?.text).toBe('Wire Codex Title');
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(temporary, { recursive: true, force: true });
    }
}, 60_000);

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

const installResumeProviders = async (bin: string): Promise<void> => {
    const driver = join(bin, 'resume-driver.ts');
    await writeFile(
        driver,
        `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ args: process.argv.slice(2), hook: process.env.RUIMTE_HOOK_TOKEN, session: process.env.RUIMTE_SESSION_ID }) + '\\n');
`
    );
    for (const provider of ['claude', 'codex'] as const) {
        await installExecutable(bin, provider, `exec '${process.execPath}' '${driver}' "$@"`);
    }
};

const installTitleProviders = async (bin: string): Promise<void> => {
    for (const provider of ['claude', 'codex'] as const) {
        await installExecutable(
            bin,
            provider,
            `if [ "$1" = exec ] || { [ "$1" = -p ] && [ "$2" != --output-format ] && [ "$2" != --input-format ]; }; then
    printf '%s\\n' '{"title":"Wire Codex Title"}'
    exit 0
fi
exec '${process.execPath}' '${join(repositoryRoot, `apps/server-rust/tests/providers/fake-${provider}.ts`)}' "$@"`
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

const providerLaunches = async (path: string): Promise<any[]> =>
    (await readFile(path, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => typeof entry.hook === 'string' && entry.hook.length > 0);

const sendAndWait = async (client: any, chatId: string, text: string): Promise<any> => {
    await client.call('chat.send', { chatId, text });
    return waitFor(async () => {
        const attached = await client.call('chat.attach', { chatId });
        return attached.info.activeTurnId === null && attached.items.some((item: any) => item.kind === 'assistant') ? attached : null;
    });
};

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
