import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { FakeLanguageTransport } from './fake-daemon';
import { LanguageStatusTracker } from './status';

function status(server: string, state: LanguageServerStatus['state'], extra: Partial<LanguageServerStatus> = {}): LanguageServerStatus {
    return { server, state, version: '1.0.0', documents: 0, ...extra };
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

describe('language status', () => {
    test('reads the status of every kind and lets a store read it as a snapshot that changes with the state', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('language.status', () => ({ servers: [status('typescript', 'not-installed'), status('php', 'not-installed')] }));
        const tracker = new LanguageStatusTracker(transport, 'p1');
        const seen: (readonly LanguageServerStatus[])[] = [];
        tracker.subscribe(() => seen.push(tracker.getSnapshot()));
        await tracker.refresh();
        expect(tracker.getSnapshot().map((entry) => entry.state)).toEqual(['not-installed', 'not-installed']);
        transport.emit('language.status', { projectId: 'p1', status: status('typescript', 'ready', { documents: 2 }) });
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'ready', documents: 2 });
        expect(seen).toHaveLength(2);
        expect(seen[0]).not.toBe(seen[1]);
    });

    test('ignores another project', async () => {
        const transport = new FakeLanguageTransport();
        const tracker = new LanguageStatusTracker(transport, 'p1');
        transport.emit('language.status', { projectId: 'p2', status: status('typescript', 'ready') });
        expect(tracker.getSnapshot()).toEqual([]);
    });

    test('asks the daemon to install only when told to, and follows the install on the machine', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('language.status', () => ({ servers: [status('php', 'stopped', { documents: 1 })] }));
        transport.answers.set('language.install', () => ({ status: status('php', 'installing') }));
        const tracker = new LanguageStatusTracker(transport, 'p1');
        await tracker.refresh();
        expect(transport.callsOf('language.install')).toEqual([]);
        await tracker.install('php');
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'installing' });
        transport.emit('language.status', { projectId: null, status: status('php', 'not-installed', { message: 'The installer exited with code 1' }) });
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'not-installed', message: 'The installer exited with code 1', documents: 1 });
        transport.emit('language.status', { projectId: null, status: status('php', 'stopped') });
        await settle();
        expect(transport.callsOf('language.status')).toHaveLength(2);
    });

    test('restarts, reads the log and asks again when the link comes back', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('language.restart', () => ({ status: status('typescript', 'ready') }));
        transport.answers.set('language.log', () => ({ lines: [{ at: 1, stream: 'server', text: 'hello' }] }));
        transport.answers.set('language.status', () => ({ servers: [status('typescript', 'crashed', { message: 'gone' })] }));
        const tracker = new LanguageStatusTracker(transport, 'p1');
        await tracker.restart('typescript');
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'ready' });
        expect(await tracker.log('typescript')).toEqual([{ at: 1, stream: 'server', text: 'hello' }]);
        transport.setStatus('closed');
        transport.setStatus('open');
        await settle();
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'crashed' });
    });
});
