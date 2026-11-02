import { afterEach, describe, expect, jest, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatSpawnOptions, SpawnChatProcess } from '@adecore/agents/chat';
import { ProviderRegistry } from '../providers/registry.ts';
import { EditorAssistModel } from './model.ts';

const homes: string[] = [];
const models: EditorAssistModel[] = [];

afterEach(async () => {
    await Promise.all(models.splice(0).map((model) => model.dispose()));
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
    jest.useRealTimers();
});

async function harness(kind = 'claude') {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-assist-'));
    homes.push(home);
    const launches: ChatSpawnOptions[] = [];
    const prompts: string[] = [];
    const streams: Array<{ write(text: string): void; exit(code: number): void }> = [];
    let wake: (() => void) | undefined;
    let awaited = 0;
    const spawn: SpawnChatProcess = (options) => {
        launches.push(options);
        wake?.();
        let output!: ReadableStreamDefaultController<Uint8Array>;
        let closed = false;
        const stdout = new ReadableStream<Uint8Array>({
            start: (controller) => {
                output = controller;
            }
        });
        const exit = (code: number): void => {
            if (closed) {
                return;
            }
            closed = true;
            output.close();
            options.onExit(code);
        };
        streams.push({ write: (text) => output.enqueue(new TextEncoder().encode(text)), exit });
        return {
            pid: 1000 + launches.length,
            stdout,
            stdin: { write: (text) => prompts.push(text), flush: () => undefined, end: () => undefined },
            kill: () => exit(1)
        };
    };
    const registry = new ProviderRegistry({ detect: async (command) => ({ installed: command === (kind === 'antigravity' ? 'agy' : kind), version: null }) });
    const model = new EditorAssistModel({
        home,
        registry,
        spawn,
        env: { RUIMTE_AGENT_TOKEN: 'secret', CLAUDECODE: '1', PATH: '/bin' },
        accounts: {
            snapshot: () => ({ accounts: { [kind]: { kind } }, statuses: [], secretsAvailable: false, loginCommands: {} }),
            envFor: (_kind, account, env) => ({ ...env, CLAUDE_CONFIG_DIR: `/accounts/${account}` })
        }
    });
    models.push(model);
    const started = async (): Promise<void> => {
        awaited++;
        while (launches.length < awaited) {
            await new Promise<void>((resolve) => {
                wake = resolve;
            });
        }
    };
    return { model, streams, launches, prompts, started };
}

describe('editor model generations', () => {
    test.each(['claude', 'codex', 'grok', 'antigravity'])('starts %s in print mode without its chat server arguments', async (kind) => {
        const rig = await harness(kind);
        const answer = rig.model.generate({ purpose: 'names', prompt: 'x' });
        await rig.started();
        const command = rig.launches[0]!.command;
        expect(command[0]).toBe(kind === 'antigravity' ? 'agy' : kind);
        expect(command).not.toContain('--acp');
        expect(command).not.toContain('app-server');
        expect(command).toContain('--model');
        expect(kind === 'codex' ? command[1] : command.includes('-p')).toBe(kind === 'codex' ? 'exec' : true);
        rig.streams[0]!.write('count');
        rig.streams[0]!.exit(0);
        expect(await answer).toEqual({ state: 'done', text: 'count' });
    });

    test('streams plain text, passes the selected model and account, and never starts in the project', async () => {
        const rig = await harness();
        const text: string[] = [];
        const answer = rig.model.generate({ purpose: 'explain', prompt: 'function add() {}', onText: (value) => text.push(value) });
        await rig.started();
        expect(rig.launches[0]?.command).toContain('claude-haiku-5-5');
        expect(rig.launches[0]?.command).toContain('--tools');
        expect(rig.launches[0]?.cwd).toEndWith('/editor-assist');
        expect(rig.launches[0]?.env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/accounts/claude' });
        expect(rig.prompts[0]).toContain('You explain source code');
        expect(rig.prompts[0]).toContain('function add() {}');
        rig.streams[0]!.write('Adds ');
        rig.streams[0]!.write('two numbers.');
        rig.streams[0]!.exit(0);
        expect(await answer).toEqual({ state: 'done', text: 'Adds two numbers.' });
        expect(text.at(-1)).toBe('Adds two numbers.');
    });

    test('cancels only that generation, and a subsequent request still works', async () => {
        const rig = await harness();
        const controller = new AbortController();
        const answer = rig.model.generate({ purpose: 'ghost', prompt: 'const x =' }, controller.signal);
        await rig.started();
        controller.abort();
        expect(await answer).toEqual({ state: 'aborted', text: '' });
        const next = rig.model.generate({ purpose: 'names', prompt: 'const x = 1' });
        await rig.started();
        rig.streams[1]!.write('count');
        rig.streams[1]!.exit(0);
        expect(await next).toEqual({ state: 'done', text: 'count' });
    });

    test('bounds concurrent requests before their asynchronous selection, and aborts when disposed', async () => {
        const rig = await harness();
        const pending = Array.from({ length: 4 }, () => rig.model.generate({ purpose: 'names', prompt: 'x' }));
        await expect(rig.model.generate({ purpose: 'names', prompt: 'x' })).rejects.toMatchObject({ code: 'busy' });
        await rig.started();
        await rig.model.dispose();
        expect((await Promise.all(pending)).every((result) => result.state === 'aborted')).toBe(true);
        await expect(rig.model.generate({ purpose: 'names', prompt: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
    });

    test('reports a CLI failure instead of presenting its output as a successful suggestion', async () => {
        const rig = await harness();
        const answer = rig.model.generate({ purpose: 'names', prompt: 'x' });
        const failed = answer.catch((error: unknown) => error);
        await rig.started();
        rig.streams[0]!.exit(1);
        expect(await failed).toMatchObject({ code: 'failed' });
    });

    test('ends a stalled CLI at the timeout', async () => {
        jest.useFakeTimers();
        const rig = await harness();
        const answer = rig.model.generate({ purpose: 'names', prompt: 'x' });
        const failed = answer.catch((error: unknown) => error);
        await rig.started();
        jest.advanceTimersByTime(60_000);
        expect(await failed).toMatchObject({ code: 'failed' });
    });
});
