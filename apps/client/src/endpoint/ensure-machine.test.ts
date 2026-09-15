import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState } from '@/transport/transport';
import { MachineLinks, MachineWaitCancelled } from './ensure-machine';

const row = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: '',
    wsBaseUrl: '',
    reachability: 'public',
    token: null,
    daemonId: id,
    daemonPublicKey: 'key',
    direct: true,
    brokerUrl: 'wss://broker.example.com',
    pairedBy: 'statement',
    needsStatement: true
});

/* A pool in memory: a link starts connecting when it is first held, and a test says how it ends. */
const fakePool = (options: { rows?: Endpoint[]; account?: string[] } = {}) => {
    const rows = [...(options.rows ?? [])];
    const states = new Map<string, ConnectionState>();
    const handlers = new Map<string, Set<() => void>>();
    const log: string[] = [];
    const set = (id: string, state: ConnectionState): void => {
        states.set(id, state);
        for (const handler of [...(handlers.get(id) ?? [])]) {
            handler();
        }
    };
    const links = new MachineLinks({
        rowFor: (id) => rows.find((entry) => entry.id === id || entry.daemonId === id) ?? null,
        createRow: (id) => {
            if (!(options.account ?? []).includes(id)) {
                throw new Error('That machine is not in the list or on your account');
            }
            log.push(`create:${id}`);
            const made = row(id);
            rows.push(made);
            return made;
        },
        connection: (id) => states.get(id) ?? { status: 'closed', attempts: 0, retryAt: null },
        hold: (endpoint) => {
            log.push(`hold:${endpoint.id}`);
            if (!states.has(endpoint.id)) {
                states.set(endpoint.id, { status: 'connecting', attempts: 0, retryAt: null });
            }
            return () => log.push(`release:${endpoint.id}`);
        },
        subscribe: (id, handler) => {
            const listeners = handlers.get(id) ?? new Set();
            listeners.add(handler);
            handlers.set(id, listeners);
            return () => listeners.delete(handler);
        },
        reconnect: (id) => {
            log.push(`reconnect:${id}`);
            states.set(id, { status: 'connecting', attempts: 0, retryAt: null });
        },
        timeoutMs: 1000
    });
    return { links, rows, log, set, handlers };
};

const OPEN: ConnectionState = { status: 'open', attempts: 0, retryAt: null, failure: null };

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('ensuring a machine is reachable', () => {
    test('a machine that is already open answers at once, without a hold or a new row', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        pool.set('studio', OPEN);
        expect(await pool.links.ensure('studio')).toBe('studio');
        expect(pool.log).toEqual([]);
    });

    test('a machine only the account knows gets its row once, and resolves when its link opens', async () => {
        const pool = fakePool({ account: ['attic'] });
        const waiting = pool.links.ensure('attic');
        expect(pool.rows.map((entry) => entry.id)).toEqual(['attic']);
        pool.set('attic', OPEN);
        expect(await waiting).toBe('attic');
        expect(pool.log).toEqual(['create:attic', 'hold:attic', 'release:attic']);
    });

    test('the first attempt that fails rejects with its reason, and lets go of the hold', async () => {
        const pool = fakePool({ account: ['attic'] });
        const waiting = pool.links.ensure('attic');
        pool.set('attic', { status: 'closed', attempts: 1, retryAt: 1, failure: 'No network path to the machine' });
        await expect(waiting).rejects.toThrow('No network path to the machine');
        expect(pool.log).toContain('release:attic');
        expect(pool.handlers.get('attic')?.size ?? 0).toBe(0);
    });

    test('a close without a reason still says the machine is not answering', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const waiting = pool.links.ensure('studio');
        pool.set('studio', { status: 'closed', attempts: 1, retryAt: 1, failure: null });
        await expect(waiting).rejects.toThrow('That machine is not answering');
    });

    test('concurrent calls share one attempt and one row', async () => {
        const pool = fakePool({ account: ['attic'] });
        const first = pool.links.ensure('attic');
        const second = pool.links.ensure('attic');
        expect(second).toBe(first);
        pool.set('attic', OPEN);
        expect(await Promise.all([first, second])).toEqual(['attic', 'attic']);
        expect(pool.log.filter((step) => step.startsWith('create:'))).toEqual(['create:attic']);
    });

    test('a link waiting out its backoff is tried again straight away', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        pool.set('studio', { status: 'closed', attempts: 3, retryAt: 10_000, failure: 'Gone' });
        const waiting = pool.links.ensure('studio');
        expect(pool.log).toEqual(['hold:studio', 'reconnect:studio']);
        pool.set('studio', OPEN);
        expect(await waiting).toBe('studio');
    });

    test('a link that never settles runs out of time', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const waiting = pool.links.ensure('studio');
        jest.advanceTimersByTime(1000);
        await expect(waiting).rejects.toThrow('That machine is not answering');
    });

    test('a machine neither in the list nor on the account is refused with why', async () => {
        const pool = fakePool();
        await expect(pool.links.ensure('nowhere')).rejects.toThrow('not in the list or on your account');
    });

    test('after a failure the next call makes a new attempt', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const first = pool.links.ensure('studio');
        pool.set('studio', { status: 'closed', attempts: 1, retryAt: 1, failure: 'Gone' });
        await expect(first).rejects.toThrow('Gone');
        const second = pool.links.ensure('studio');
        expect(second).not.toBe(first);
        pool.set('studio', OPEN);
        expect(await second).toBe('studio');
    });
    test('a caller that stops waiting ends the attempt and lets go of the hold', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const controller = new AbortController();
        const waiting = pool.links.ensure('studio', controller.signal);
        expect(pool.log).toEqual(['hold:studio']);
        controller.abort();
        await expect(waiting).rejects.toBeInstanceOf(MachineWaitCancelled);
        expect(pool.log).toEqual(['hold:studio', 'release:studio']);
        expect(pool.handlers.get('studio')?.size ?? 0).toBe(0);
    });

    test('one caller stopping leaves the attempt to the caller that still waits', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const controller = new AbortController();
        const leaving = pool.links.ensure('studio', controller.signal);
        const staying = pool.links.ensure('studio', new AbortController().signal);
        controller.abort();
        await expect(leaving).rejects.toBeInstanceOf(MachineWaitCancelled);
        expect(pool.log).not.toContain('release:studio');
        pool.set('studio', OPEN);
        expect(await staying).toBe('studio');
        expect(pool.log).toEqual(['hold:studio', 'release:studio']);
    });

    test('a caller without a signal keeps the attempt alive when another one stops', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const controller = new AbortController();
        const pinned = pool.links.ensure('studio');
        const leaving = pool.links.ensure('studio', controller.signal);
        controller.abort();
        await expect(leaving).rejects.toBeInstanceOf(MachineWaitCancelled);
        pool.set('studio', OPEN);
        expect(await pinned).toBe('studio');
    });

    test('after stopping, the next ask starts a new attempt', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const controller = new AbortController();
        const first = pool.links.ensure('studio', controller.signal);
        controller.abort();
        await expect(first).rejects.toBeInstanceOf(MachineWaitCancelled);
        const second = pool.links.ensure('studio');
        expect(pool.log).toEqual(['hold:studio', 'release:studio', 'hold:studio']);
        pool.set('studio', OPEN);
        expect(await second).toBe('studio');
    });

    test('a signal that already aborted asks nothing of the pool', async () => {
        const pool = fakePool({ rows: [row('studio')] });
        const controller = new AbortController();
        controller.abort();
        await expect(pool.links.ensure('studio', controller.signal)).rejects.toBeInstanceOf(MachineWaitCancelled);
        expect(pool.log).toEqual([]);
    });
});
