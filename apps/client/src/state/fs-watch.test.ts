import { describe, expect, test } from 'bun:test';
import { FolderWatches, isUnderFolder } from '@/state/fs-watch';
import type { Transport, TransportStatus } from '@/transport/transport';

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
