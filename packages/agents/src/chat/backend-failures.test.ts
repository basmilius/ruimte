import { expect, test } from 'bun:test';
import { CodexBackend } from './codex-backend.ts';
import { codexProvider } from '../providers/codex-provider.ts';
import { fakeCodexWith } from './fake-codex.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import type { BackendEvent, BackendLaunch } from './backend.ts';
import type { ChatProcess, ChatSpawnOptions } from './chat-process.ts';
import { ClaudeBackend } from './claude-backend.ts';
import { CodexTransport } from './codex-transport.ts';
import { inProcess, type FakeIo, type FakeCli } from './fake-cli.ts';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) {
        await Promise.resolve();
    }
};

const launch: BackendLaunch = {
    command: ['unused'],
    cwd: '/tmp',
    env: {},
    selection: claudeProvider.catalog.normalize(undefined),
    modelName: 'Claude',
    runtimeMode: 'supervised',
    resume: null,
    generation: 1,
    instructions: null,
    resumeNote: null
};

const pipe = (program?: FakeCli) => {
    let io: FakeIo;
    let options: ChatSpawnOptions;
    let broken = false;
    const fake = inProcess((madeIo) => {
        io = madeIo;
        return program?.(madeIo) ?? { onLine: () => undefined };
    });
    return {
        spawn: (madeOptions: ChatSpawnOptions): ChatProcess => {
            options = madeOptions;
            const process = fake.spawn(madeOptions);
            return {
                ...process,
                stdin: {
                    ...process.stdin,
                    write: (chunk) => {
                        if (broken) {
                            throw new Error('broken pipe');
                        }
                        return process.stdin.write(chunk);
                    }
                }
            };
        },
        out: (frame: unknown) => io.out(frame),
        break: () => {
            broken = true;
        },
        error: () => options.onError?.(new Error('asynchronous pipe failure')),
        exit: async () => {
            fake.started[0]!.crash(0);
            await fake.started[0]!.exited;
        }
    };
};

test('Claude continues reading after an event consumer throws and reports the failure without killing the process', async () => {
    const fake = pipe();
    const events: BackendEvent[] = [];
    const backend = new ClaudeBackend(
        { ...launch, spawn: fake.spawn },
        {
            onEvent: (event) => {
                if (event.type === 'text.done') {
                    throw new Error('consumer failed');
                }
                events.push(event);
            }
        }
    );
    await backend.start();
    fake.out({ type: 'assistant', message: { id: 'text', content: [{ type: 'text', text: 'hello' }] } });
    fake.out({ type: 'result', subtype: 'success' });
    await flush();
    expect(events).toContainEqual({ type: 'failed', message: 'Claude transport failed: consumer failed', processAlive: true });
    expect(events).toContainEqual({ type: 'turn.done', state: 'done', costUsd: 0 });
    expect(backend.running).toBe(true);
    await fake.exit();
});

test('Claude rejects a failed answer write, withdraws it, and never answers that id twice', async () => {
    const fake = pipe();
    const events: BackendEvent[] = [];
    const backend = new ClaudeBackend({ ...launch, spawn: fake.spawn }, { onEvent: (event) => events.push(event) });
    await backend.start();
    fake.out({
        type: 'control_request',
        request_id: 'approval',
        request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'true' }, tool_use_id: 'tool' }
    });
    await flush();
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    fake.break();
    expect(backend.respondApproval('approval', 'allow')).toBe(false);
    expect(events).toContainEqual({ type: 'request.withdrawn', requestId: 'approval' });
    expect(events).toContainEqual({ type: 'failed', message: 'Claude transport failed: broken pipe', processAlive: true });
    expect(backend.respondApproval('approval', 'allow')).toBe(false);
    expect(() => backend.sendTurn({ text: 'no', preamble: null, attachments: [], mentions: [], skills: [] })).toThrow('broken pipe');
    await fake.exit();
});

test('Codex keeps reading after a frame consumer throws, and its outstanding RPC fails visibly', async () => {
    const fake = pipe();
    const failures: Error[] = [];
    const frames: unknown[] = [];
    const transport = new CodexTransport({
        ...launch,
        spawn: fake.spawn,
        onFrame: (frame) => {
            if (frame.method === 'broken') {
                throw new Error('consumer failed');
            }
            frames.push(frame);
        },
        onError: (error) => failures.push(error),
        onExit: () => undefined
    });
    const first = transport.request('turn/start', {}).catch((error: unknown) => error);
    fake.out({ method: 'broken', params: {} });
    fake.out({ method: 'later', params: {} });
    await flush();
    expect(await first).toBeInstanceOf(Error);
    expect(failures[0]?.message).toContain('consumer failed');
    expect(frames).toContainEqual({ method: 'later', params: {} });
    const next = transport.request('thread/read', {});
    fake.out({ id: 2, result: { okay: true } });
    await expect(next).resolves.toEqual({ okay: true });
    expect(transport.alive).toBe(true);
    await fake.exit();
});

test('Codex write and asynchronous pipe failures settle requests immediately without assuming an exit', async () => {
    const fake = pipe();
    const failures: Error[] = [];
    const transport = new CodexTransport({
        ...launch,
        spawn: fake.spawn,
        onFrame: () => undefined,
        onError: (error) => failures.push(error),
        onExit: () => undefined
    });
    const pending = transport.request('initialize', {}).catch((error: unknown) => error);
    fake.error();
    expect(await pending).toBeInstanceOf(Error);
    expect(failures[0]?.message).toContain('asynchronous pipe failure');
    fake.break();
    await expect(transport.request('turn/start', {})).rejects.toThrow('broken pipe');
    expect(() => transport.respond('approval', {})).toThrow('broken pipe');
    expect(transport.alive).toBe(true);
    await fake.exit();
});

test('Codex acknowledges its submitted prompt and rejects an undelivered approval answer without killing native work', async () => {
    const fake = pipe(fakeCodexWith({}));
    const events: BackendEvent[] = [];
    const backend = new CodexBackend(
        { ...launch, selection: codexProvider.catalog.normalize(undefined), spawn: fake.spawn },
        { onEvent: (event) => events.push(event) }
    );
    await backend.start();
    backend.sendTurn({ promptId: 'codex-prompt', text: 'tool: true', preamble: null, attachments: [], mentions: [], skills: [] });
    await flush();
    expect(events).toContainEqual({ type: 'turn.accepted', promptId: 'codex-prompt' });
    const approval = events.find((event) => event.type === 'approval.requested');
    expect(approval?.type).toBe('approval.requested');
    if (approval?.type !== 'approval.requested') {
        throw new Error('The fake did not request approval');
    }
    fake.break();
    expect(backend.respondApproval(approval.requestId, 'allow')).toBe(false);
    expect(events).toContainEqual({ type: 'request.withdrawn', requestId: approval.requestId });
    expect(events).toContainEqual({ type: 'failed', message: 'broken pipe', processAlive: true });
    expect(backend.respondApproval(approval.requestId, 'allow')).toBe(false);
    expect(backend.running).toBe(true);
    await fake.exit();
});
