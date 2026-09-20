import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import type { SpeechEvent } from '@ruimte/desktop-bridge';
import { SpeechService } from './speech';

const fixture = () => {
    const events: SpeechEvent[] = [];
    let now = 0;
    let nextTimer = 0;
    const scheduled = new Map<number, { at: number; action(): void }>();
    const timers = {
        setTimeout: ((action: () => void, delay: number) => {
            const id = ++nextTimer;
            scheduled.set(id, { at: now + delay, action });
            return id;
        }) as unknown as typeof setTimeout,
        clearTimeout: ((id: number) => scheduled.delete(id)) as unknown as typeof clearTimeout
    };
    const advance = (elapsed: number): void => {
        now += elapsed;
        for (const [id, timer] of scheduled) {
            if (timer.at <= now) {
                scheduled.delete(id);
                timer.action();
            }
        }
    };
    const children: ReturnType<typeof child>[] = [];
    function child() {
        const emitter = new EventEmitter();
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        let killed = false;
        const commands: Record<string, unknown>[] = [];
        stdin.on('data', (bytes) => commands.push(JSON.parse(String(bytes))));
        return Object.assign(emitter, {
            stdin,
            stdout,
            stderr,
            commands,
            kill: () => {
                killed = true;
            },
            getKilled: () => killed
        });
    }
    const service = new SpeechService(
        'helper',
        'model',
        'cache',
        (event) => events.push(event),
        (() => {
            const next = child();
            children.push(next);
            return next;
        }) as unknown as typeof spawn,
        timers
    );
    const emit = (index: number, value: object) => children[index]!.stdout.write(`${JSON.stringify(value)}\n`);
    return { service, children, events, emit, advance };
};

test('waits for ready and keeps a finished helper warm for sixty seconds', async () => {
    const run = fixture();
    const started = run.service.start('first', 'nl-NL');
    run.emit(0, { type: 'ready', sessionId: 'first' });
    await started;
    await run.service.samples('first', new Float32Array([0.25]));
    await run.service.stop('first');
    run.emit(0, { type: 'transcript', sessionId: 'first', text: 'Hallo.', final: true });
    run.emit(0, { type: 'ended', sessionId: 'first' });
    const next = run.service.start('second', 'en-GB');
    run.emit(0, { type: 'ready', sessionId: 'second' });
    await next;
    expect(run.children).toHaveLength(1);
    run.emit(0, { type: 'ended', sessionId: 'second' });
    run.advance(59_999);
    expect(run.children[0]!.getKilled()).toBe(false);
    run.advance(1);
    expect(run.children[0]!.getKilled()).toBe(true);
});
test('an old process closing cannot clear a new session', async () => {
    const run = fixture();
    const old = run.service.start('old', 'nl-NL');
    const rejection = old.catch((error: Error) => error.message);
    run.service.cancel('old');
    expect(await rejection).toContain('cancelled');
    const fresh = run.service.start('new', 'nl-NL');
    run.children[0]!.emit('close', 0);
    run.emit(0, { type: 'failed', sessionId: 'old', message: 'old' });
    run.emit(1, { type: 'ready', sessionId: 'new' });
    await fresh;
    await run.service.samples('new', new Float32Array([0.5]));
    expect(run.children[1]!.commands.at(-1)?.sessionId).toBe('new');
    expect(run.children[1]!.getKilled()).toBe(false);
    run.service.dispose();
});
test('a load timeout rejects the start and kills the helper', async () => {
    const run = fixture();
    const pending = run.service.start('slow', 'nl-NL');
    const rejection = pending.catch((error: Error) => error.message);
    run.advance(120_000);
    expect(await rejection).toContain('too long');
    expect(run.children[0]!.getKilled()).toBe(true);
    expect(run.events[0]?.type).toBe('failed');
});
test('stale samples and non-finite audio do not reach the process', async () => {
    const run = fixture();
    const pending = run.service.start('current', 'nl-NL');
    run.emit(0, { type: 'ready', sessionId: 'current' });
    await pending;
    await run.service.samples('old', new Float32Array([1]));
    await expect(run.service.samples('current', new Float32Array([NaN]))).rejects.toThrow('Invalid');
    expect(run.children[0]!.commands).toHaveLength(1);
    run.service.dispose();
});

test('reports a native crash signal when the helper has no stderr', async () => {
    const run = fixture();
    const result = run.service.start('crash', 'en-GB').catch((error: Error) => error.message);
    run.children[0]!.emit('close', null, 'SIGBUS');
    expect(await result).toContain('SIGBUS');
    expect(run.events).toContainEqual({ type: 'failed', sessionId: 'crash', message: 'Speech helper stopped unexpectedly (signal SIGBUS)' });
});
