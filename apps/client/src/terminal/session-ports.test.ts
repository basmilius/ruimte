import { expect, test } from 'bun:test';
import type { SessionPortVerification, SessionPortsResult } from '@ruimte/contracts';
import { TransportError } from '@/transport/transport';
import { SessionPortWatch, type PortWatchOptions } from './session-ports';

const listener = { pid: 12, startTime: 1234, port: 5173, bindAddress: '127.0.0.1', host: '127.0.0.1' as const };

function harness() {
    let live = true;
    let result: SessionPortsResult = { status: 'ready', ports: [listener] };
    let exit: ((payload: { sessionId: string; exitCode: number }) => void) | null = null;
    let pollGate: Promise<void> | null = null;
    let openGate: Promise<void> | null = null;
    let failure: Error | null = null;
    let now = 0;
    let verified: SessionPortVerification = { url: 'http://127.0.0.1:5173/', machineId: 'owner-machine', validForMs: 5000 };
    const changes: SessionPortsResult[] = [];
    const requests: string[] = [];
    const timers = new Set<() => void>();
    const deadlines = new Map<() => void, number>();
    const options: PortWatchOptions = {
        transport: {
            request: async (type: string) => {
                requests.push(type);
                await (type === 'session.ports' ? pollGate : openGate);
                if (failure) {
                    throw failure;
                }
                return type === 'session.ports' ? result : verified;
            },
            on: (_event: string, callback: typeof exit) => {
                exit = callback;
                return () => {
                    exit = null;
                };
            }
        } as PortWatchOptions['transport'],
        sessionId: 'one',
        now: () => now,
        deadline: (callback, ms) => {
            deadlines.set(callback, ms);
            return () => {
                deadlines.delete(callback);
            };
        },
        live: () => live,
        changed: (value) => changes.push(value),
        schedule: (callback) => {
            timers.add(callback);
            return () => {
                timers.delete(callback);
            };
        }
    };
    const watch = new SessionPortWatch(options);
    return {
        watch,
        requests,
        changes,
        timers,
        deadlines,
        end: () => exit?.({ sessionId: 'one', exitCode: 0 }),
        move: () => {
            live = false;
        },
        fail: (error = new Error('offline')) => {
            failure = error;
        },
        advance: (ms: number) => {
            now += ms;
        },
        verified: (value: SessionPortVerification) => {
            verified = value;
        },
        result: (value: SessionPortsResult) => {
            result = value;
        },
        pausePoll: (value: Promise<void>) => {
            pollGate = value;
        },
        pauseOpen: (value: Promise<void>) => {
            openGate = value;
        }
    };
}

test('polling never opens a browser, schedules only after a reply and stops on exit', async () => {
    const setup = harness();
    const gate = Promise.withResolvers<void>();
    setup.pausePoll(gate.promise);
    const reading = setup.watch.poll();
    await setup.watch.poll();
    expect(setup.requests).toHaveLength(1);
    expect(setup.timers.size).toBe(0);
    gate.resolve();
    await reading;
    expect(setup.requests).toEqual(['session.ports']);
    expect(setup.timers.size).toBe(1);
    setup.end();
    expect(setup.timers.size).toBe(0);
    await setup.watch.poll();
    expect(setup.requests).toHaveLength(1);
});

test('transport failure is unknown, while closed and unsupported replies end polling', async () => {
    const failed = harness();
    failed.fail();
    await failed.watch.poll();
    expect(failed.changes).toEqual([{ status: 'unknown' }]);
    failed.watch.stop();
    for (const status of ['closed', 'unavailable'] as const) {
        const setup = harness();
        setup.result({ status });
        await setup.watch.poll();
        expect(setup.timers.size).toBe(0);
    }
});

test('late scans and clicks do nothing after unmount, exit, restart or workspace change', async () => {
    for (const cancel of [
        (setup: ReturnType<typeof harness>) => setup.watch.stop(),
        (setup: ReturnType<typeof harness>) => setup.end(),
        (setup: ReturnType<typeof harness>) => setup.move()
    ]) {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pausePoll(gate.promise);
        setup.pauseOpen(gate.promise);
        let opened = false;
        const pending = [
            setup.watch.poll(),
            setup.watch.open(listener, async () => {
                opened = true;
            })
        ];
        cancel(setup);
        gate.resolve();
        await Promise.all(pending);
        expect(opened).toBe(false);
        expect(setup.changes).toEqual([]);
        expect(setup.timers.size).toBe(0);
    }
});

test('only an explicit verified click opens and repeated clicks cannot race', async () => {
    const setup = harness();
    const gate = Promise.withResolvers<void>();
    setup.pauseOpen(gate.promise);
    const opened: string[] = [];
    const open = async (url: string): Promise<void> => {
        opened.push(url);
    };
    const first = setup.watch.open(listener, open);
    await setup.watch.open(listener, open);
    expect(opened).toEqual([]);
    gate.resolve();
    await first;
    expect(opened).toEqual(['http://127.0.0.1:5173/']);
    expect(setup.requests).toEqual(['session.verifyPort']);
    setup.watch.stop();
});

test('a reply delayed beyond its validity never opens, but a fresh explicit click can reverify', async () => {
    for (const delay of [5000, 60_000]) {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pauseOpen(gate.promise);
        const opened: string[] = [];
        const open = async (url: string, machineId: string): Promise<void> => {
            opened.push(`${machineId}:${url}`);
        };
        const pending = setup.watch.open(listener, open);
        setup.advance(delay);
        gate.resolve();
        await pending;
        expect(opened).toEqual([]);
        expect(setup.changes).toEqual([{ status: 'unknown' }]);
        await setup.watch.open(listener, open);
        expect(opened).toEqual(['owner-machine:http://127.0.0.1:5173/']);
        expect(setup.requests).toEqual(['session.verifyPort', 'session.verifyPort']);
        setup.watch.stop();
    }
});

test('an older daemon stops polling permanently instead of repeatedly reporting a failed scan', async () => {
    for (const operation of ['poll', 'open'] as const) {
        const setup = harness();
        setup.fail(new TransportError('unknown-request', 'Unknown request'));
        if (operation === 'poll') {
            await setup.watch.poll();
        } else {
            await setup.watch.open(listener, async () => {
                throw new Error('must not open');
            });
        }
        expect(setup.changes).toEqual([{ status: 'unavailable' }]);
        expect(setup.timers.size).toBe(0);
        await setup.watch.poll();
        await setup.watch.open(listener, async () => {
            throw new Error('must not open');
        });
        expect(setup.requests).toHaveLength(1);
    }
});

test('legacy verification without machine ownership or bounded validity is unsupported', async () => {
    for (const answer of [
        { url: 'http://127.0.0.1:5173/' },
        { url: 'http://127.0.0.1:5173/', machineId: 'owner-machine' },
        { url: 'http://127.0.0.1:5173/', validForMs: 5000 }
    ]) {
        const setup = harness();
        setup.verified(answer);
        await setup.watch.open(listener, async () => {
            throw new Error('must not open');
        });
        expect(setup.changes).toEqual([{ status: 'unavailable' }]);
        await setup.watch.poll();
        expect(setup.requests).toHaveLength(1);
    }
});

test('the verification deadline releases the click and ignores a later successful response', async () => {
    const setup = harness();
    const gate = Promise.withResolvers<void>();
    setup.pauseOpen(gate.promise);
    const opened: string[] = [];
    const opening = setup.watch.open(listener, async (url) => {
        opened.push(url);
    });
    expect([...setup.deadlines.values()]).toEqual([5000]);
    [...setup.deadlines.keys()][0]!();
    await opening;
    expect(setup.changes).toEqual([{ status: 'unknown' }]);
    expect(setup.deadlines.size).toBe(0);
    gate.resolve();
    await Promise.resolve();
    expect(opened).toEqual([]);
    setup.watch.stop();
});
