import { afterEach, describe, expect, test } from 'bun:test';
import type { AppleFoundationRequest } from '@ruimte/contracts';
import { AppleBackend, type AppleBackendOptions } from './apple-backend.ts';
import type { executeAppleTool } from './apple-tools.ts';
import type { BackendEvent, TurnInput } from './backend.ts';
import { inProcess, type FakeIo } from './fake-cli.ts';

const turn: TurnInput = { text: 'List the project files.', preamble: null, attachments: [], mentions: [], skills: [] };
const backends: AppleBackend[] = [];
afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
});

const harness = (available = true, executeTool?: typeof executeAppleTool, throwToolResult = false, options: AppleBackendOptions = {}, protocolVersion = 3) => {
    let io: FakeIo;
    const requests: AppleFoundationRequest[] = [];
    const events: BackendEvent[] = [];
    const waiters: Array<{ predicate: () => boolean; resolve: () => void }> = [];
    const fake = inProcess((output) => {
        io = output;
        output.out({ type: 'availability', available, ...(available ? {} : { reason: 'modelNotReady' }) });
        if (available) {
            output.out({ type: 'session', protocolVersion, id: output.argv[output.argv.indexOf('--session') + 1], restored: false });
        }
        return {
            onLine: (line) => {
                const request = JSON.parse(line);
                if (throwToolResult && request.type === 'tool.result') {
                    throw new Error('Pipe closed');
                }
                requests.push(request);
            }
        };
    });
    const backend = new AppleBackend(
        {
            command: ['fake-apple'],
            cwd: '/tmp',
            env: {},
            selection: { model: 'apple-system', options: {} },
            modelName: 'Apple',
            runtimeMode: 'full-access',
            resume: null,
            generation: 1,
            context: [],
            depth: 0,
            spawn: fake.spawn
        },
        {
            onEvent: (event) => {
                events.push(event);
                for (const waiter of [...waiters]) {
                    if (waiter.predicate()) {
                        waiters.splice(waiters.indexOf(waiter), 1);
                        waiter.resolve();
                    }
                }
            }
        },
        executeTool ?? (async () => ({ output: 'Project files.', failed: false })),
        options
    );
    backends.push(backend);
    return {
        backend,
        events,
        requests,
        out: (frame: unknown) => io.out(frame),
        until: (predicate: () => boolean): Promise<void> => (predicate() ? Promise.resolve() : new Promise((resolve) => waiters.push({ predicate, resolve })))
    };
};

const call = { type: 'tool.call', id: '1-1-tool-1', name: 'list_files', path: '.' };

describe('Apple Foundation Models backend', () => {
    test('forwards partial text before the model finishes its turn', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out({ type: 'text.snapshot', id: '1-1', text: 'First words' });
        await rig.until(() => rig.events.some((event) => event.type === 'text.delta'));
        expect(rig.events.some((event) => event.type === 'turn.done')).toBe(false);
        expect(rig.events.find((event) => event.type === 'text.delta')).toMatchObject({ text: 'First words' });
    });

    test('uses Claude-style cards while preserving the private tool call for execution', async () => {
        let executed: unknown;
        const rig = harness(true, async (_cwd, tool) => {
            executed = tool;
            return { output: 'Updated.', failed: false };
        });
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        const edit = { type: 'tool.call', id: '1-1-tool-1', name: 'edit_file', path: 'README.md', oldText: 'before', newText: 'after' };
        rig.out(edit);
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        const input = { file_path: 'README.md', old_string: 'before', new_string: 'after' };
        expect(rig.events.find((event) => event.type === 'tool.started')).toMatchObject({ name: 'Edit', input });
        expect(rig.events.find((event) => event.type === 'approval.requested')).toMatchObject({ toolName: 'Edit', input });
        expect(executed).toBeUndefined();
        rig.backend.respondApproval(edit.id, 'allow');
        await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
        expect(executed).toEqual(edit);
    });

    test('converts cumulative and revised snapshots without duplicating text', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        for (const text of ['Hello', 'Hello world', 'Hello world', 'Hi world']) {
            rig.out({ type: 'text.snapshot', id: '1-1', text });
        }
        rig.out({ type: 'done', id: '1-1', state: 'done' });
        await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
        expect(
            rig.events
                .filter((event) => event.type === 'text.delta')
                .map((event) => event.text)
                .join('')
        ).toBe('Hello world');
        expect(rig.events.filter((event) => event.type === 'text.done').at(-1)?.text).toBe('Hi world');
    });

    test.each(['allow', 'deny'] as const)('waits for approval, then returns %s to the actual tool continuation', async (decision) => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out(call);
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        expect(rig.requests.filter((request) => request.type === 'tool.result')).toHaveLength(0);
        expect(rig.backend.respondApproval(call.id, decision, 'Test refusal')).toBe(true);
        await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
        const reply = rig.requests.find((request) => request.type === 'tool.result');
        expect(reply?.type === 'tool.result' && reply.output).toBe(decision === 'allow' ? 'Project files.' : 'Denied by the person: Test refusal');
        expect(rig.backend.respondApproval(call.id, 'allow')).toBe(false);
        rig.out(call);
        rig.out({ type: 'done', id: '1-1', state: 'done' });
        await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
        expect(rig.events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    });

    test('cancel withdraws approval and ignores late model output and tool requests', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out(call);
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        rig.backend.interrupt();
        expect(rig.backend.respondApproval(call.id, 'allow')).toBe(false);
        rig.out({ ...call, id: '1-1-tool-2' });
        rig.out({ type: 'text.snapshot', id: '1-1', text: 'Too late' });
        rig.out({ type: 'done', id: '1-1', state: 'done' });
        await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
        expect(rig.events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
        expect(rig.events.some((event) => event.type === 'request.withdrawn')).toBe(true);
        expect(rig.events.some((event) => event.type === 'text.delta')).toBe(false);
        expect(rig.events.find((event) => event.type === 'turn.done')?.state).toBe('aborted');
        expect(rig.requests.at(-1)).toEqual({ type: 'cancel', id: '1-1' });
    });

    test('unavailable model fails startup without a fallback', async () => {
        const rig = harness(false);
        await expect(rig.backend.start()).rejects.toThrow('modelNotReady');
        expect(rig.requests).toHaveLength(0);
    });

    test('oversized or unsupported input never reaches the helper', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn({ ...turn, text: '🙂'.repeat(1600) });
        expect(rig.requests).toHaveLength(0);
        expect(rig.events.find((event) => event.type === 'turn.done')?.state).toBe('error');
    });

    test('malformed tool arguments fail closed', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out({ ...call, path: 42 });
        await rig.until(() => rig.events.some((event) => event.type === 'failed'));
        expect(rig.events.some((event) => event.type === 'approval.requested')).toBe(false);
        expect(rig.requests.filter((request) => request.type === 'tool.result')).toHaveLength(0);
    });

    test.each(['list_files', 'read_file'] as const)('executes %s only after approval and delivers its output', async (name) => {
        const calls: Parameters<typeof executeAppleTool>[] = [];
        const rig = harness(true, async (...args) => {
            calls.push(args);
            return { output: 'Project context from approved tool.', failed: false };
        });
        await rig.backend.start();
        rig.backend.sendTurn({ ...turn, text: 'Read the project notes.' });
        const fileCall = { type: 'tool.call', id: '1-1-tool-1', name, path: name === 'read_file' ? 'README.md' : '.', offset: 0 };
        rig.out(fileCall);
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        expect(calls).toHaveLength(0);
        expect(rig.backend.respondApproval(fileCall.id, 'allow')).toBe(true);
        await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]).toBe('/tmp');
        expect(calls[0]?.[1]).toMatchObject({ name, path: fileCall.path });
        expect(rig.requests.at(-1)).toEqual({ type: 'tool.result', id: fileCall.id, output: 'Project context from approved tool.', outcome: 'success' });
    });

    test('denied file reads never execute', async () => {
        let executed = false;
        const rig = harness(true, async () => {
            executed = true;
            return { output: 'Private contents', failed: false };
        });
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'read_file', path: 'README.md', offset: 0 });
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        expect(rig.backend.respondApproval('1-1-tool-1', 'deny')).toBe(true);
        expect(executed).toBe(false);
        expect(rig.requests.at(-1)).toEqual({ type: 'tool.result', id: '1-1-tool-1', output: 'Denied by the person.', outcome: 'denied' });
    });

    test('a closed helper pipe while delivering an approved result fails the chat without an unhandled rejection', async () => {
        const rig = harness(true, async () => ({ output: 'File content', failed: false }), true);
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'read_file', path: 'README.md', offset: 0 });
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        rig.backend.respondApproval('1-1-tool-1', 'allow');
        await rig.until(() => rig.events.some((event) => event.type === 'failed'));
        expect(rig.events.find((event) => event.type === 'failed')?.message).toContain('could not receive');
        expect(rig.requests.some((request) => request.type === 'tool.result')).toBe(false);
    });

    test('stop aborts an approved file read and discards its late result', async () => {
        let finish!: (result: Awaited<ReturnType<typeof executeAppleTool>>) => void;
        let signal: AbortSignal | undefined;
        let execution: Promise<Awaited<ReturnType<typeof executeAppleTool>>>;
        const rig = harness(true, (_cwd, _call, currentSignal) => {
            signal = currentSignal;
            execution = new Promise((resolve) => {
                finish = resolve;
            });
            return execution;
        });
        await rig.backend.start();
        rig.backend.sendTurn(turn);
        rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'read_file', path: 'README.md', offset: 0 });
        await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
        rig.backend.respondApproval('1-1-tool-1', 'allow');
        rig.backend.interrupt();
        expect(signal?.aborted).toBe(true);
        rig.out({ type: 'done', id: '1-1', state: 'aborted' });
        await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
        rig.backend.sendTurn({ ...turn, text: 'A new turn.' });
        finish({ output: 'Late file content', failed: false });
        await execution!;
        expect(rig.requests.some((request) => request.type === 'tool.result')).toBe(false);
        expect(rig.events.filter((event) => event.type === 'tool.done')).toEqual([
            { type: 'tool.done', ref: '1-1-tool-1', output: 'Cancelled.', state: 'error' }
        ]);
    });

    test('keeps the helper for later turns and reports only current context changes', async () => {
        const rig = harness();
        await rig.backend.start();
        rig.backend.sendTurn({ ...turn, text: 'Remember project code ORCHID.' });
        rig.out({ type: 'done', id: '1-1', state: 'done' });
        await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
        rig.backend.sendTurn({ ...turn, text: 'What is the project code?' });
        rig.out({ type: 'context', id: '1-1', text: 'Stale context notice' });
        rig.out({ type: 'context', id: '1-2', text: 'Older turns were removed.' });
        rig.out({ type: 'done', id: '1-2', state: 'done' });
        await rig.until(() => rig.events.filter((event) => event.type === 'turn.done').length === 2);
        expect(rig.requests.filter((request) => request.type === 'turn').map((request) => request.id)).toEqual(['1-1', '1-2']);
        const notes = rig.events.filter((event) => event.type === 'note');
        expect(notes.filter((event) => event.text.includes('conversation memory'))).toHaveLength(1);
        expect(notes.some((event) => event.text === 'Older turns were removed.')).toBe(true);
        expect(notes.some((event) => event.text === 'Stale context notice')).toBe(false);
    });
});

test('ask_user creates a question card and returns the answer without a tool approval', async () => {
    const rig = harness();
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'ask_user', question: 'Which color?', options: ['Blue', 'Green'] });
    await rig.until(() => rig.events.some((event) => event.type === 'question.requested'));
    expect(rig.events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(rig.backend.respondQuestion('1-1-tool-1', { '1-1-tool-1': 'Blue' })).toBe(true);
    expect(rig.requests.at(-1)).toEqual({ type: 'tool.result', id: '1-1-tool-1', output: 'Blue', outcome: 'success' });
    expect(rig.backend.respondQuestion('1-1-tool-1', { '1-1-tool-1': 'Green' })).toBe(false);
});

test('stopping an unanswered question withdraws the card', async () => {
    const rig = harness();
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'ask_user', question: 'Continue?' });
    await rig.until(() => rig.events.some((event) => event.type === 'question.requested'));
    rig.backend.interrupt();
    expect(rig.events.some((event) => event.type === 'request.withdrawn' && event.requestId === '1-1-tool-1')).toBe(true);
    expect(rig.backend.respondQuestion('1-1-tool-1', { '1-1-tool-1': 'Yes' })).toBe(false);
});

test('disabling Apple refuses a pending approval before execution', async () => {
    let enabled = true;
    let executed = false;
    const rig = harness(
        true,
        async () => {
            executed = true;
            return { output: '', failed: false };
        },
        false,
        { enabled: () => enabled }
    );
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out(call);
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    enabled = false;
    expect(rig.backend.respondApproval(call.id, 'allow')).toBe(false);
    expect(executed).toBe(false);
    expect(rig.events.some((event) => event.type === 'failed')).toBe(true);
});

test('native compaction ends its turn and explains that history was removed', async () => {
    const rig = harness();
    await rig.backend.start();
    rig.backend.compact();
    expect(rig.requests.at(-1)).toEqual({ type: 'compact', id: '1-1' });
    rig.out({ type: 'compacted', id: '1-1', text: 'Removed older complete turns; latest two retained.' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(rig.events.some((event) => event.type === 'compaction')).toBe(true);
    expect(rig.events.find((event) => event.type === 'turn.done')?.state).toBe('done');
});

test('file change evidence reaches the existing tool row', async () => {
    const changes = [{ path: 'notes.txt', kind: 'update' as const, diff: 'a diff' }];
    const rig = harness(true, async () => ({ output: 'Edited notes.txt', failed: false, changes }));
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out({ type: 'tool.call', id: '1-1-tool-1', name: 'edit_file', path: 'notes.txt', oldText: 'old', newText: 'new' });
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    rig.backend.respondApproval('1-1-tool-1', 'allow');
    await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
    expect(rig.events.find((event) => event.type === 'tool.done')?.changes).toEqual(changes);
});

const manualDeadlines = () => {
    const pending = new Map<() => void, number>();
    return {
        schedule: (callback: () => void, milliseconds: number) => {
            pending.set(callback, milliseconds);
            return () => {
                pending.delete(callback);
            };
        },
        durations: () => [...pending.values()],
        fire: (milliseconds: number) => {
            for (const [callback, duration] of [...pending]) {
                if (duration === milliseconds) {
                    pending.delete(callback);
                    callback();
                }
            }
        }
    };
};

test('a denial seals the turn before a model can ask again, and the next turn remains usable', async () => {
    const rig = harness();
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out(call);
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    rig.backend.respondApproval(call.id, 'deny');
    rig.out({ type: 'tool.call', id: '1-1-tool-2', name: 'ask_user', question: 'Try again?' });
    rig.out({ type: 'text.snapshot', id: '1-1', text: 'I read the file anyway.' });
    rig.out({ type: 'done', id: '1-1', state: 'done' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(rig.events.some((event) => event.type === 'question.requested' || event.type === 'text.delta')).toBe(false);
    expect(rig.events.find((event) => event.type === 'turn.done')).toMatchObject({ state: 'aborted', error: 'Denied by the person.' });
    rig.backend.sendTurn(turn);
    rig.out({ type: 'text.snapshot', id: '1-2', text: 'New turn.' });
    rig.out({ type: 'done', id: '1-2', state: 'done' });
    await rig.until(() => rig.events.filter((event) => event.type === 'turn.done').length === 2);
    expect(rig.events.filter((event) => event.type === 'turn.done').at(-1)).toMatchObject({ state: 'done' });
});

test('a rejected exact match stays visible and permits a separately approved correction', async () => {
    let executions = 0;
    const rig = harness(true, async () => {
        executions++;
        return executions === 1 ? { output: 'Edit rejected. No file was changed.', failed: true, recoverable: true } : { output: 'Updated.', failed: false };
    });
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    const edit = { type: 'tool.call', id: call.id, name: 'edit_file', path: 'planning.md', oldText: 'wrong', newText: 'new' };
    rig.out(edit);
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    rig.backend.respondApproval(edit.id, 'allow');
    await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
    expect(rig.events.find((event) => event.type === 'tool.done')).toMatchObject({ state: 'error' });
    expect(rig.requests.at(-1)).toMatchObject({ type: 'tool.result', outcome: 'recoverable_error' });
    const correction = { ...edit, id: '1-1-tool-2', oldText: 'actual' };
    rig.out(correction);
    await rig.until(() => rig.events.filter((event) => event.type === 'approval.requested').length === 2);
    expect(executions).toBe(1);
    rig.backend.respondApproval(correction.id, 'allow');
    await rig.until(() => rig.events.filter((event) => event.type === 'tool.done').length === 2);
    rig.out({ type: 'done', id: '1-1', state: 'done' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(executions).toBe(2);
    expect(rig.events.find((event) => event.type === 'turn.done')).toMatchObject({ state: 'done' });
});

test('a failed write cannot be followed by a successful model claim or an automatic retry', async () => {
    let executions = 0;
    const rig = harness(true, async () => {
        executions++;
        return { output: 'File already exists.', failed: true };
    });
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out({ type: 'tool.call', id: call.id, name: 'write_file', path: 'existing.md', content: 'Replacement' });
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    rig.backend.respondApproval(call.id, 'allow');
    await rig.until(() => rig.events.some((event) => event.type === 'tool.done'));
    rig.out({ ...call, id: '1-1-tool-2' });
    rig.out({ type: 'text.snapshot', id: '1-1', text: 'Saved!' });
    rig.out({ type: 'done', id: '1-1', state: 'done' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(executions).toBe(1);
    expect(rig.events.filter((event) => event.type === 'tool.started')).toHaveLength(1);
    expect(rig.events.some((event) => event.type === 'text.delta')).toBe(false);
    expect(rig.events.find((event) => event.type === 'turn.done')).toMatchObject({ state: 'error', error: 'File already exists.' });
});

test('model deadline pauses for a human and resumes after their answer', async () => {
    const deadlines = manualDeadlines();
    const rig = harness(true, undefined, false, { schedule: deadlines.schedule });
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    expect(deadlines.durations()).toEqual([120_000]);
    rig.out({ type: 'tool.call', id: call.id, name: 'ask_user', question: 'Which day?' });
    await rig.until(() => rig.events.some((event) => event.type === 'question.requested'));
    expect(deadlines.durations()).toEqual([]);
    rig.backend.respondQuestion(call.id, { [call.id]: 'Thursday' });
    expect(deadlines.durations()).toEqual([120_000]);
    deadlines.fire(120_000);
    expect(rig.requests.at(-1)).toEqual({ type: 'cancel', id: '1-1' });
    rig.out({ type: 'done', id: '1-1', state: 'aborted' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(rig.events.find((event) => event.type === 'turn.done')).toMatchObject({ state: 'error' });
    expect(deadlines.durations()).toEqual([]);
});

test('an execution deadline aborts its tool and discards late success', async () => {
    const deadlines = manualDeadlines();
    let signal: AbortSignal | undefined;
    let release: ((result: { output: string; failed: boolean }) => void) | undefined;
    const rig = harness(
        true,
        async (_cwd, _call, receivedSignal) => {
            signal = receivedSignal;
            return new Promise((resolve) => {
                release = resolve;
            });
        },
        false,
        { schedule: deadlines.schedule }
    );
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out(call);
    await rig.until(() => rig.events.some((event) => event.type === 'approval.requested'));
    expect(deadlines.durations()).toEqual([]);
    rig.backend.respondApproval(call.id, 'allow');
    expect(deadlines.durations()).toEqual([60_000]);
    deadlines.fire(60_000);
    expect(signal?.aborted).toBe(true);
    expect(rig.requests.at(-1)).toMatchObject({ type: 'tool.result', outcome: 'error' });
    release?.({ output: 'Late success', failed: false });
    rig.out({ type: 'done', id: '1-1', state: 'done' });
    await rig.until(() => rig.events.some((event) => event.type === 'turn.done'));
    expect(rig.events.filter((event) => event.type === 'tool.done')).toHaveLength(1);
    expect(rig.events.find((event) => event.type === 'turn.done')).toMatchObject({ state: 'error' });
});

test('an older helper cannot silently ignore typed tool refusals', async () => {
    const rig = harness(true, undefined, false, {}, 1);
    await expect(rig.backend.start()).rejects.toThrow('outdated');
});

test('native measured context reaches usage without invented output token counts', async () => {
    const rig = harness();
    await rig.backend.start();
    rig.backend.sendTurn(turn);
    rig.out({ type: 'metrics', id: '1-1', elapsedMs: 500, firstTextMs: 200, toolCalls: 2, contextTokens: 3000, schemaTokens: 120 });
    await rig.until(() => rig.events.some((event) => event.type === 'usage'));
    expect(rig.events.find((event) => event.type === 'usage')).toMatchObject({ contextTokens: 3000 });
});
