import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { FakeLanguageTransport } from './fake-daemon';
import { settleLanguage as settle } from './settle.test';
import { LanguageStatusTracker } from './status';

function status(server: string, state: LanguageServerStatus['state'], extra: Partial<LanguageServerStatus> = {}): LanguageServerStatus {
    return { server, state, version: '1.0.0', documents: 0, ...extra };
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

    test('ignores another project', () => {
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
        expect(transport.callsOf('language.install').map((call) => call.payload)).toEqual([{ server: 'php' }]);
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'installing' });
        transport.emit('language.status', { projectId: null, status: status('php', 'not-installed', { message: 'The installer exited with code 1' }) });
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'not-installed', message: 'The installer exited with code 1', documents: 1 });
        transport.emit('language.status', { projectId: null, status: status('php', 'stopped') });
        await settle();
        expect(transport.callsOf('language.status')).toHaveLength(2);
    });

    test('asks the daemon to use the other PHP server and takes the answer and the event for the one it replaced', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('language.status', () => ({
            servers: [status('php-native', 'stopped', { chosen: false }), status('php', 'not-installed', { chosen: true })]
        }));
        transport.answers.set('language.prefer', () => ({ status: status('php-native', 'ready', { chosen: true }) }));
        const tracker = new LanguageStatusTracker(transport, 'p1');
        await tracker.refresh();
        transport.answers.set('language.status', () => ({
            servers: [status('php-native', 'ready', { chosen: true }), status('php', 'not-installed', { chosen: true })]
        }));
        await tracker.prefer('php-native');
        expect(transport.callsOf('language.prefer').map((call) => call.payload)).toEqual([{ server: 'php-native' }]);
        await settle();
        transport.emit('language.status', { projectId: null, status: status('php', 'not-installed', { chosen: false }) });
        expect(tracker.getSnapshot().map((entry) => [entry.server, entry.chosen])).toEqual([
            ['php-native', true],
            ['php', false]
        ]);
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
        expect(transport.callsOf('language.restart').map((call) => call.payload)).toEqual([{ projectId: 'p1', server: 'typescript' }]);
        expect(transport.callsOf('language.log').map((call) => call.payload)).toEqual([{ projectId: 'p1', server: 'typescript' }]);
        transport.setStatus('closed');
        transport.setStatus('open');
        await settle();
        expect(tracker.getSnapshot()[0]).toMatchObject({ state: 'crashed' });
    });
});

describe('trace', () => {
    test('switches the trace of a server and takes the status it answers', async () => {
        const transport = new FakeLanguageTransport();
        transport.connection = { ...transport.connection, features: ['language.trace'] };
        transport.answers.set('language.trace', () => ({ status: status('typescript', 'ready', { trace: 'verbose' }) }));
        const tracker = new LanguageStatusTracker(transport, 'p1');
        await tracker.trace('typescript', 'verbose');

        expect(transport.callsOf('language.trace').map((call) => call.payload)).toEqual([{ projectId: 'p1', server: 'typescript', value: 'verbose' }]);
        expect(tracker.getSnapshot()[0]).toMatchObject({ trace: 'verbose' });
    });

    test('sends nothing to a machine that cannot', async () => {
        const transport = new FakeLanguageTransport();
        const tracker = new LanguageStatusTracker(transport, 'p1');
        await tracker.trace('typescript', 'verbose');

        expect(tracker.canTrace()).toBe(false);
        expect(transport.callsOf('language.trace')).toHaveLength(0);
    });
});
