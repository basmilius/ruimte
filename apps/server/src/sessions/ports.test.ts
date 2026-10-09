import { describe, expect, test } from 'bun:test';
import type { ProcessSampler, RawProcess, RawSample } from '../processes/sampler.ts';
import type { TcpListener } from '../processes/listeners.ts';
import { SessionPorts, sessionTree, type PortSession } from './ports.ts';

function proc(pid: number, ppid: number, overrides: Partial<RawProcess> = {}): RawProcess {
    return {
        pid,
        ppid,
        uid: 501,
        startTime: pid * 1000,
        name: 'test',
        path: null,
        readable: true,
        cpuNs: 0,
        memory: 0,
        diskRead: 0,
        diskWrite: 0,
        ...overrides
    };
}

function harness() {
    const first = { id: 'first', pid: 100 };
    const second = { id: 'second', pid: 200 };
    const sessions = new Map<string, PortSession>([
        [first.id, first],
        [second.id, second]
    ]);
    let table = [proc(100, 1), proc(101, 100), proc(102, 101), proc(200, 1), proc(201, 200), proc(300, 1)];
    let listeners: TcpListener[] = [
        { pid: 102, port: 5173, bindAddress: '127.0.0.1', host: '127.0.0.1' },
        { pid: 201, port: 3000, bindAddress: '[::1]', host: '[::1]' },
        { pid: 300, port: 8080, bindAddress: '127.0.0.1', host: '127.0.0.1' }
    ];
    let now = 0;
    let scans = 0;
    const targets: (number | undefined)[] = [];
    let failure = false;
    let probeFailure = false;
    let pause: Promise<void> | null = null;
    let signal: AbortSignal | undefined;
    const sampler: ProcessSampler = {
        sample: () => {
            if (failure) {
                throw new Error('denied');
            }
            return { processes: table } as RawSample;
        },
        inspect: (pid) => table.find((entry) => entry.pid === pid) ?? null,
        commandLine: () => null
    };
    const ports = new SessionPorts({
        machineId: 'owner-machine',
        sampler,
        probe: {
            read: async (_pids, abort, port) => {
                targets.push(port);
                scans++;
                signal = abort;
                await pause;
                if (probeFailure) {
                    throw new Error('lsof failed');
                }
                return port === undefined ? listeners : listeners.filter((listener) => listener.port === port);
            }
        },
        sessions: () => [...sessions.values()],
        current: (id) => sessions.get(id),
        uid: 501,
        now: () => now
    });
    ports.track(first);
    ports.track(second);
    return {
        ports,
        targets,
        sessions,
        first,
        second,
        sampler,
        setTable: (value: RawProcess[]) => {
            table = value;
        },
        setListeners: (value: TcpListener[]) => {
            listeners = value;
        },
        advance: () => {
            now += 5001;
        },
        fail: () => {
            failure = true;
        },
        failProbe: () => {
            probeFailure = true;
        },
        pause: (value: Promise<void>) => {
            pause = value;
        },
        scans: () => scans,
        aborted: () => signal?.aborted
    };
}

const listener = { pid: 102, startTime: 102000, port: 5173, bindAddress: '127.0.0.1', host: '127.0.0.1' as const };

describe('session listener ownership', () => {
    test('finds grandchildren, separates sessions, drops unrelated listeners and deduplicates sockets', async () => {
        const setup = harness();
        setup.setListeners([
            { ...listener },
            { ...listener },
            { pid: 201, port: 3000, bindAddress: '[::1]', host: '[::1]' },
            { pid: 300, port: 8080, bindAddress: '127.0.0.1', host: '127.0.0.1' }
        ]);
        expect(await setup.ports.list('first')).toEqual({ status: 'ready', ports: [listener] });
        expect(await setup.ports.list('second')).toEqual({
            status: 'ready',
            ports: [{ pid: 201, startTime: 201000, port: 3000, bindAddress: '[::1]', host: '[::1]' }]
        });
        expect(setup.scans()).toBe(1);
    });

    test('scan errors are unknown and clear a previously successful result', async () => {
        const setup = harness();
        await setup.ports.list('first');
        setup.fail();
        setup.advance();
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
    });

    test('an empty successful scan is ready and a stopped listener cannot be opened from cache', async () => {
        const setup = harness();
        await setup.ports.list('first');
        setup.setListeners([]);
        await expect(setup.ports.verify('first', listener)).rejects.toThrow('could not be verified');
        expect(await setup.ports.list('first')).toEqual({ status: 'ready', ports: [] });
        expect(setup.scans()).toBe(2);
    });

    test('a failed listener command is unknown and cannot authorize opening', async () => {
        const setup = harness();
        setup.failProbe();
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
        await expect(setup.ports.verify('first', listener)).rejects.toThrow('could not be verified');
    });

    test('the tree stops at other session roots', async () => {
        const setup = harness();
        setup.setTable([proc(100, 1), proc(200, 100), proc(201, 200)]);
        expect(await setup.ports.list('first')).toEqual({ status: 'ready', ports: [] });
        expect(await setup.ports.list('second')).toMatchObject({ status: 'ready', ports: [{ pid: 201, port: 3000 }] });
    });

    test('too many sessions exceed the scan budget explicitly', async () => {
        const setup = harness();
        for (let i = 0; i < 128; i++) {
            setup.sessions.set(`extra-${i}`, { id: `extra-${i}`, pid: 1000 + i });
        }
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
        expect(setup.scans()).toBe(0);
    });

    test('opening rechecks the listener and refuses a port from another session', async () => {
        const setup = harness();
        await setup.ports.list('first');
        expect(await setup.ports.verify('first', listener)).toEqual({ url: 'http://127.0.0.1:5173/', machineId: 'owner-machine', validForMs: 5000 });
        setup.advance();
        await expect(setup.ports.verify('second', listener)).rejects.toThrow('could not be verified');
        expect(setup.scans()).toBe(3);
        expect(setup.targets).toEqual([undefined, 5173, 5173]);
    });

    test('root PID reuse cannot repin the session and child PID reuse invalidates the old chip', async () => {
        const setup = harness();
        await setup.ports.list('first');
        setup.setTable([proc(100, 1), proc(101, 100), proc(102, 101, { startTime: 999999 })]);
        await expect(setup.ports.verify('first', listener)).rejects.toThrow('could not be verified');
        setup.setTable([proc(100, 1, { startTime: 123456 }), proc(102, 100)]);
        setup.advance();
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
    });

    test('a child moving to another tree during discovery is unknown', async () => {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pause(gate.promise);
        const reading = setup.ports.list('first');
        setup.setTable([proc(100, 1), proc(102, 1)]);
        gate.resolve();
        expect(await reading).toEqual({ status: 'unknown' });
    });

    test('one in-flight scan serves concurrent polls, and a click never waits in an unbounded queue', async () => {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pause(gate.promise);
        const one = setup.ports.list('first');
        const two = setup.ports.list('second');
        await expect(setup.ports.verify('first', listener)).rejects.toThrow('busy');
        expect(setup.scans()).toBe(1);
        gate.resolve();
        await Promise.all([one, two]);
        await setup.ports.list('first');
        expect(setup.scans()).toBe(1);
        setup.advance();
        await setup.ports.list('first');
        expect(setup.scans()).toBe(2);
    });

    test('closing or replacing a session while a scan runs discards the result', async () => {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pause(gate.promise);
        const reading = setup.ports.list('first');
        setup.sessions.delete('first');
        setup.ports.forget(setup.first);
        setup.sessions.delete('second');
        setup.ports.forget(setup.second);
        expect(setup.aborted()).toBe(true);
        setup.sessions.set('first', { id: 'first', pid: 100 });
        gate.resolve();
        expect(await reading).toEqual({ status: 'closed' });
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
    });

    test('closing during verification never returns an openable URL', async () => {
        const setup = harness();
        const gate = Promise.withResolvers<void>();
        setup.pause(gate.promise);
        const opening = setup.ports.verify('first', listener);
        setup.sessions.delete('first');
        setup.ports.forget(setup.first);
        gate.resolve();
        await expect(opening).rejects.toThrow('could not be verified');
    });

    test('unsupported platforms are explicit and an unpinned root stays unknown', async () => {
        const setup = harness();
        setup.ports.forget(setup.first);
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
        const ports = new SessionPorts({
            machineId: 'owner-machine',
            sampler: null,
            probe: null,
            sessions: () => [setup.first],
            current: () => setup.first,
            uid: 501
        });
        expect(await ports.list('first')).toEqual({ status: 'unavailable' });
        const failed = new SessionPorts({
            machineId: 'owner-machine',
            sampler: null,
            probe: { read: async () => [] },
            sessions: () => [setup.first],
            current: () => setup.first,
            uid: 501
        });
        expect(await failed.list('first')).toEqual({ status: 'unknown' });
    });

    test('foreign processes, cycles, unknown starts and excessive trees are unverifiable', () => {
        const root = { id: 'one', pid: 100 };
        const owner = { startTime: 100000, uid: 501 };
        for (const table of [
            [proc(100, 1), proc(101, 100, { uid: 0 })],
            [proc(100, 101), proc(101, 100)],
            [proc(100, 1), proc(101, 100, { startTime: 0 })],
            Array.from({ length: 2049 }, (_, i) => proc(100 + i, i === 0 ? 1 : 99 + i))
        ]) {
            expect(() => sessionTree(table, root, owner)).toThrow();
        }
    });
});

test('a competing destination owner makes wildcard and shared loopback bindings unknown', async () => {
    for (const bindAddress of ['*', '0.0.0.0', '127.0.0.1']) {
        const setup = harness();
        const own = { ...listener, bindAddress };
        setup.setListeners([own]);
        expect(await setup.ports.list('first')).toEqual({ status: 'ready', ports: [own] });
        setup.setListeners([own, { pid: 300, port: own.port, host: '127.0.0.1', bindAddress: '127.0.0.1' }]);
        await expect(setup.ports.verify('first', own)).rejects.toThrow('could not be verified');
        expect(await setup.ports.list('first')).toEqual({ status: 'unknown' });
    }
});

test('IPv6 wildcard ambiguity is refused, while a different interface destination is unrelated', async () => {
    const setup = harness();
    setup.setListeners([listener, { pid: 300, port: listener.port, host: '127.0.0.1', bindAddress: '192.168.1.2' }]);
    expect(await setup.ports.list('first')).toEqual({ status: 'ready', ports: [listener] });
    setup.setListeners([listener, { pid: 300, port: listener.port, host: '[::1]', bindAddress: '*' }]);
    await expect(setup.ports.verify('first', listener)).rejects.toThrow('could not be verified');
});

test('a changed bind address and an old client lacking it cannot authorize a destination', async () => {
    const setup = harness();
    await setup.ports.list('first');
    setup.setListeners([{ ...listener, bindAddress: '*' }]);
    await expect(setup.ports.verify('first', listener)).rejects.toThrow('could not be verified');
    setup.advance();
    const { bindAddress: _binding, ...legacy } = listener;
    await expect(setup.ports.verify('first', legacy)).rejects.toThrow('could not be verified');
});
