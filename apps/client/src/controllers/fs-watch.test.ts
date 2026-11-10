import { describe, expect, test } from 'bun:test';
import { FolderWatches } from '@/controllers/fs-watch';
import { isUnderFolder } from '@/paths/file-path';
import type { Transport, TransportStatus } from '@/transport-api/transport';

interface Call {
    endpointId: string;
    type: string;
    path: string;
}

/* A transport that only records what was asked of it, per machine, and whose link drops and comes back when a test says so. */
function fakePool(
    calls: Call[]
): ((endpointId: string) => Transport) & { setStatus(endpointId: string, status: TransportStatus): void; listening(endpointId: string): number } {
    const links = new Map<string, Transport>();
    const listeners = new Map<string, Set<(status: TransportStatus) => void>>();
    const linkFor = (endpointId: string): Transport => {
        let link = links.get(endpointId);
        if (link === undefined) {
            const heard = new Set<(status: TransportStatus) => void>();
            listeners.set(endpointId, heard);
            link = {
                request: (type: string, payload: { path: string }) => {
                    calls.push({ endpointId, type, path: payload.path });
                    return Promise.resolve({});
                },
                on: () => () => undefined,
                status: 'open',
                subscribeStatus: (handler: (status: TransportStatus) => void) => {
                    heard.add(handler);
                    return () => heard.delete(handler);
                }
            } as unknown as Transport;
            links.set(endpointId, link);
        }
        return link;
    };
    return Object.assign(linkFor, {
        setStatus: (endpointId: string, status: TransportStatus): void => {
            for (const handler of [...(listeners.get(endpointId) ?? [])]) {
                handler(status);
            }
        },
        listening: (endpointId: string): number => listeners.get(endpointId)?.size ?? 0
    });
}

describe('isUnderFolder', () => {
    test('answers for both separators', () => {
        expect(isUnderFolder('/a/b', '/a')).toBe(true);
        expect(isUnderFolder('C:\\a\\b', 'C:\\a')).toBe(true);
        expect(isUnderFolder('/a', '/a')).toBe(false);
        expect(isUnderFolder('/ab', '/a')).toBe(false);
    });
});

describe('FolderWatches', () => {
    test('asks the daemon once however many readers hold the folder', () => {
        const calls: Call[] = [];
        const watches = new FolderWatches(fakePool(calls));
        const first = watches.watch('local', '/project');
        const second = watches.watch('local', '/project');
        expect(calls).toEqual([{ endpointId: 'local', type: 'fs.watch', path: '/project' }]);
        first.release();
        expect(calls).toHaveLength(1);
        second.release();
        expect(calls[1]).toEqual({ endpointId: 'local', type: 'fs.unwatch', path: '/project' });
    });

    test('releasing twice unwatches once', () => {
        const calls: Call[] = [];
        const watches = new FolderWatches(fakePool(calls));
        const watch = watches.watch('local', '/project');
        watch.release();
        watch.release();
        expect(calls.filter((call) => call.type === 'fs.unwatch')).toHaveLength(1);
    });

    test('the same folder on two machines is two watches', () => {
        const calls: Call[] = [];
        const watches = new FolderWatches(fakePool(calls));
        watches.watch('local', '/project');
        watches.watch('remote', '/project');
        expect(calls).toEqual([
            { endpointId: 'local', type: 'fs.watch', path: '/project' },
            { endpointId: 'remote', type: 'fs.watch', path: '/project' }
        ]);
    });

    test('a folder that was covered asks again when the one above it goes', () => {
        const calls: Call[] = [];
        const watches = new FolderWatches(fakePool(calls));
        const parent = watches.watch('local', '/project');
        watches.watch('local', '/project/docs');
        watches.watch('local', '/elsewhere');
        calls.length = 0;
        parent.release();
        expect(calls).toEqual([
            { endpointId: 'local', type: 'fs.unwatch', path: '/project' },
            { endpointId: 'local', type: 'fs.watch', path: '/project/docs' }
        ]);
    });

    test('a link that comes back is asked for every folder still held, and their readers read again', async () => {
        const calls: Call[] = [];
        const pool = fakePool(calls);
        const watches = new FolderWatches(pool);
        let rereads = 0;
        const tree = watches.watch('local', '/project', () => {
            rereads += 1;
        });
        const file = watches.watch('local', '/project', () => {
            rereads += 1;
        });
        watches.watch('remote', '/project');
        await tree.ready;
        calls.length = 0;

        pool.setStatus('local', 'closed');
        pool.setStatus('local', 'open');
        expect(calls).toEqual([{ endpointId: 'local', type: 'fs.watch', path: '/project' }]);
        await Promise.resolve();
        await Promise.resolve();
        expect(rereads).toBe(2);

        file.release();
        pool.setStatus('local', 'open');
        await Promise.resolve();
        await Promise.resolve();
        expect(rereads).toBe(3);
    });

    test('a machine with nothing held on it is no longer followed', () => {
        const calls: Call[] = [];
        const pool = fakePool(calls);
        const watches = new FolderWatches(pool);
        const first = watches.watch('local', '/project');
        const second = watches.watch('local', '/elsewhere');
        expect(pool.listening('local')).toBe(1);
        first.release();
        expect(pool.listening('local')).toBe(1);
        second.release();
        expect(pool.listening('local')).toBe(0);
        calls.length = 0;
        pool.setStatus('local', 'open');
        expect(calls).toEqual([]);
    });
});

describe('prepared folder watches', () => {
    test('the first reader keeps the readiness barrier and takes ownership without restarting it', async () => {
        const calls: string[] = [];
        let finish!: () => void;
        const ready = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const link = {
            status: 'open',
            request(type: string) {
                calls.push(type);
                return type === 'fs.watch' ? ready : Promise.resolve();
            },
            subscribeStatus: () => () => undefined
        } as unknown as Transport;
        const watches = new FolderWatches(() => link);
        const releasePreparation = watches.prepare('machine', '/folder');
        const reader = watches.watch('machine', '/folder');
        let readable = false;
        void reader.ready.then(() => {
            readable = true;
        });
        await Promise.resolve();
        expect(readable).toBe(false);
        expect(calls).toEqual(['fs.watch']);
        releasePreparation();
        expect(calls).toEqual(['fs.watch']);
        finish();
        await reader.ready;
        expect(readable).toBe(true);
        reader.release();
        expect(calls).toEqual(['fs.watch', 'fs.unwatch']);
    });

    test('cancelling before a reader arrives releases the watch and a later read starts its own', () => {
        const calls: Call[] = [];
        const watches = new FolderWatches(fakePool(calls));
        const cancel = watches.prepare('machine', '/folder');
        cancel();
        const reader = watches.watch('machine', '/folder');
        cancel();
        expect(calls.map((call) => call.type)).toEqual(['fs.watch', 'fs.unwatch', 'fs.watch']);
        reader.release();
        expect(calls.map((call) => call.type)).toEqual(['fs.watch', 'fs.unwatch', 'fs.watch', 'fs.unwatch']);
    });

    test('a replaced preparation cannot cancel the next owner or leave a hold behind', () => {
        const calls: Call[] = [];
        const pool = fakePool(calls);
        const watches = new FolderWatches(pool);
        const first = watches.prepare('machine', '/folder');
        const second = watches.prepare('machine', '/folder');
        first();
        expect(calls).toHaveLength(1);
        const reader = watches.watch('machine', '/folder');
        second();
        expect(calls).toHaveLength(1);
        reader.release();
        expect(calls.map((call) => call.type)).toEqual(['fs.watch', 'fs.unwatch']);
        expect(pool.listening('machine')).toBe(0);
    });
});

/* A link whose second watch of `/folder/src` is ready only once `finish` runs. */
function slowRenewal(): { watches: FolderWatches; finish: () => void; asks: () => number } {
    let finish!: () => void;
    const replacement = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let asks = 0;
    const link = {
        status: 'open',
        request(type: string, payload: { path: string }) {
            return type === 'fs.watch' && payload.path === '/folder/src' && ++asks > 1 ? replacement : Promise.resolve();
        },
        subscribeStatus: () => () => undefined
    } as unknown as Transport;
    return { watches: new FolderWatches(() => link), finish, asks: () => asks };
}

test('a descendant refreshes only after the watch replacing its removed ancestor is ready', async () => {
    const { watches, finish } = slowRenewal();
    let refreshed = 0;
    const root = watches.watch('machine', '/folder');
    const child = watches.watch('machine', '/folder/src', () => refreshed++);
    await child.ready;
    root.release();
    const joined = watches.watch('machine', '/folder/src');
    expect(refreshed).toBe(0);
    finish();
    await joined.ready;
    expect(refreshed).toBe(1);
    child.release();
    joined.release();
});

test('a new ancestor renews existing descendants after its readiness barrier', async () => {
    const { watches, finish, asks } = slowRenewal();
    let refreshed = 0;
    const child = watches.watch('machine', '/folder/src', () => refreshed++);
    await child.ready;
    const root = watches.watch('machine', '/folder');
    expect(asks()).toBe(2);
    expect(refreshed).toBe(0);
    finish();
    await child.ready;
    expect(refreshed).toBe(1);
    child.release();
    root.release();
});
