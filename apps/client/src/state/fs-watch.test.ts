import { describe, expect, test } from 'bun:test';
import { FolderWatches, isUnderFolder } from '@/state/fs-watch';
import type { Transport } from '@/transport/transport';

interface Call {
    endpointId: string;
    type: string;
    path: string;
}

/* A transport that only records what was asked of it, per machine. */
const fakePool = (calls: Call[]): ((endpointId: string) => Transport | null) => {
    return (endpointId) =>
        ({
            request: (type: string, payload: { path: string }) => {
                calls.push({ endpointId, type, path: payload.path });
                return Promise.resolve({});
            },
            on: () => () => undefined,
            status: 'open',
            subscribeStatus: () => () => undefined
        }) as unknown as Transport;
};

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
});
