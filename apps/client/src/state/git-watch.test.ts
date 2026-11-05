import { describe, expect, test } from 'bun:test';
import { GitWatches } from '@/state/git-watch';
import type { Transport, TransportStatus } from '@/transport-api/transport';

/* One machine's link that records what was asked of it and drops and comes back when a test says so. */
function fakeLink(): { link: Transport; calls: string[]; setStatus(status: TransportStatus): void } {
    const calls: string[] = [];
    const heard = new Set<(status: TransportStatus) => void>();
    const link = {
        request: (type: string, payload: { cwd: string }) => {
            calls.push(`${type} ${payload.cwd}`);
            return Promise.resolve(type === 'git.watch' ? { status: { cwd: payload.cwd } } : {});
        },
        on: () => () => undefined,
        status: 'open',
        subscribeStatus: (handler: (status: TransportStatus) => void) => {
            heard.add(handler);
            return () => heard.delete(handler);
        }
    } as unknown as Transport;
    return {
        link,
        calls,
        setStatus: (status) => {
            for (const handler of [...heard]) {
                handler(status);
            }
        }
    };
}

describe('GitWatches', () => {
    test('asks the daemon once however many panels hold the checkout', () => {
        const { link, calls } = fakeLink();
        const watches = new GitWatches(() => link);
        const files = watches.watch('local', '/repo');
        const panel = watches.watch('local', '/repo');
        files.release();
        expect(calls).toEqual(['git.watch /repo']);
        panel.release();
        expect(calls).toEqual(['git.watch /repo', 'git.unwatch /repo']);
    });

    test('a link that comes back watches again and has its readers read again', async () => {
        const { link, calls, setStatus } = fakeLink();
        const watches = new GitWatches(() => link);
        let reads = 0;
        const watch = watches.watch('local', '/repo', () => {
            reads += 1;
        });
        await watch.ready;

        setStatus('closed');
        setStatus('open');
        expect(calls).toEqual(['git.watch /repo', 'git.watch /repo']);
        await Promise.resolve();
        await Promise.resolve();
        expect(reads).toBe(1);

        watch.release();
        setStatus('closed');
        setStatus('open');
        expect(calls).toEqual(['git.watch /repo', 'git.watch /repo', 'git.unwatch /repo']);
    });

    test('only the reader that opened the watch gets the status it answered', async () => {
        const { link } = fakeLink();
        const watches = new GitWatches(() => link);
        const panel = watches.watch('local', '/repo');
        const tab = watches.watch('local', '/repo');
        expect(await panel.answer).toEqual({ status: { cwd: '/repo' } } as never);
        expect(await tab.answer).toBeUndefined();
        panel.release();
        tab.release();
    });
});
