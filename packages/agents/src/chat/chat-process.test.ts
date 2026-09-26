import { afterEach, describe, expect, jest, test } from 'bun:test';
import { ChatChild, StreamTail, type ChatSpawnOptions } from './chat-process.ts';

/* A process that only records what it is told, and exits when the test says so. */
const fakeChild = (onExit: (exitCode: number | null, stderr: string | null) => void = () => undefined) => {
    const signals: string[] = [];
    let exit: ChatSpawnOptions['onExit'] = () => undefined;
    let stderr: ReadableStreamDefaultController<Uint8Array> | null = null;
    const child = new ChatChild({
        command: ['cli'],
        cwd: '/',
        env: {},
        spawn: (options) => {
            exit = options.onExit;
            return {
                pid: 4242,
                stdin: { write: () => 0, flush: () => 0, end: () => 0 },
                stdout: new ReadableStream<Uint8Array>(),
                stderr: new ReadableStream<Uint8Array>({
                    start: (controller) => {
                        stderr = controller;
                    }
                }),
                kill: (signal) => {
                    signals.push(signal);
                }
            };
        },
        onExit
    });
    return {
        child,
        signals,
        say: (text: string) => stderr?.enqueue(new TextEncoder().encode(text)),
        exit: (code: number | null) => {
            stderr?.close();
            exit(code);
        }
    };
};

afterEach(() => {
    jest.useRealTimers();
});

describe('ChatChild', () => {
    test('ending sends the group a SIGTERM at once and a SIGKILL after the grace, even when the CLI left in between', async () => {
        jest.useFakeTimers();
        const { child, signals, exit } = fakeChild();
        const ended = child.end();
        expect(signals).toEqual(['SIGTERM']);
        exit(null);
        await ended;
        jest.advanceTimersByTime(1999);
        expect(signals).toEqual(['SIGTERM']);
        jest.advanceTimersByTime(1);
        expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    test('a CLI that does not leave is sent the SIGKILL, and only then does the end settle', async () => {
        jest.useFakeTimers();
        const { child, signals } = fakeChild();
        let settled = false;
        void child.end().then(() => {
            settled = true;
        });
        expect(child.end()).toBe(child.end());
        jest.advanceTimersByTime(2000);
        await child.end();
        expect(settled).toBe(true);
        expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    test('a CLI whose input closed gets the grace to leave on its own before anything is sent', () => {
        jest.useFakeTimers();
        const quiet = fakeChild();
        quiet.child.endAfterGrace();
        jest.advanceTimersByTime(2999);
        expect(quiet.signals).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(quiet.signals).toEqual(['SIGTERM']);

        const leaving = fakeChild();
        leaving.child.endAfterGrace();
        leaving.exit(0);
        jest.advanceTimersByTime(10_000);
        expect(leaving.signals).toEqual([]);
    });

    test('an exit with an error code carries the last lines of stderr, a clean one none', async () => {
        const report = () => {
            let heard: (exit: [number | null, string | null]) => void = () => undefined;
            const exit = new Promise<[number | null, string | null]>((resolve) => {
                heard = resolve;
            });
            return { exit, onExit: (code: number | null, stderr: string | null) => heard([code, stderr]) };
        };
        const crashReport = report();
        const crashed = fakeChild(crashReport.onExit);
        crashed.say('loading\n'.repeat(50));
        crashed.say('Error: no key\n  at main\n');
        crashed.exit(1);
        expect(await crashReport.exit).toEqual([1, `${'loading\n'.repeat(8)}Error: no key\n  at main`]);

        const cleanReport = report();
        const clean = fakeChild(cleanReport.onExit);
        clean.say('bye\n');
        clean.exit(0);
        expect(await cleanReport.exit).toEqual([0, null]);
    });
});

describe('StreamTail', () => {
    test('keeps no more than the tail of a long stream, and a note gets less than that', async () => {
        const encoder = new TextEncoder();
        const tail = new StreamTail(
            new ReadableStream<Uint8Array>({
                start: (controller) => {
                    controller.enqueue(encoder.encode('x'.repeat(100_000)));
                    controller.enqueue(encoder.encode(`${'y'.repeat(3000)}\n`));
                    controller.close();
                }
            })
        );
        await tail.done;
        expect(tail.lines()).toBe('y'.repeat(2000));
    });

    test('says nothing for a stream of only whitespace', async () => {
        const tail = new StreamTail(
            new ReadableStream<Uint8Array>({
                start: (controller) => {
                    controller.enqueue(new TextEncoder().encode('\n  \n'));
                    controller.close();
                }
            })
        );
        await tail.done;
        expect(tail.lines()).toBeNull();
    });
});
