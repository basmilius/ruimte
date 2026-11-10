import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { settle } from '@adecore/editor-react/testing';
import { useToasts, type Toast } from '@/state/toasts';
import { FakeLanguageTransport } from './fake-daemon';
import { watchServerPrompts } from './server-prompts';

const folder = '/work/app';

let transport: FakeLanguageTransport;
let opened: Array<{ folder: string; path: string; line: number }>;
let stop: () => void;

function toasts(): Toast[] {
    return useToasts.getState().toasts;
}

function ask(messageId: string, type = 3, actions: string[] = ['Retry', 'Ignore']): void {
    transport.emit('language.message', {
        projectId: 'p1',
        messageId,
        server: 'typescript',
        title: 'typescript',
        type,
        message: 'Restart the project?',
        actions
    });
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    transport = new FakeLanguageTransport();
    transport.connection = { ...transport.connection, features: ['language.messageAnswer'] };
    transport.answers.set('language.messageAnswer', () => ({}));
    opened = [];
    stop = watchServerPrompts(transport, 'p1', folder, (root, path, line) => opened.push({ folder: root, path, line }));
});

afterEach(() => {
    stop();
});

describe('a message without answers', () => {
    test('toasts an error with the server it came from, and a repeat replaces it', () => {
        const event = { projectId: 'p1', messageId: 'm1', server: 'typescript', title: 'typescript', type: 1, message: 'Out of memory' };
        transport.emit('language.message', event);
        transport.emit('language.message', { ...event, messageId: 'm2' });

        expect(toasts()).toHaveLength(1);
        expect(toasts()[0]).toMatchObject({ kind: 'error', title: 'Out of memory', description: 'From TypeScript' });
    });

    test('ignores another project', () => {
        transport.emit('language.message', { projectId: 'p2', messageId: 'm1', server: 'typescript', title: 'typescript', type: 1, message: 'No' });

        expect(toasts()).toHaveLength(0);
    });
});

describe('a message with answers', () => {
    test('stays until a person picks an action, and sends the one picked', async () => {
        ask('m1');

        expect(toasts()[0]).toMatchObject({ persist: true, kind: 'success', actions: [{ label: 'Retry' }, { label: 'Ignore' }] });

        toasts()[0]!.actions![1]!.run();
        await settle();

        expect(transport.callsOf('language.messageAnswer').map((call) => call.payload)).toEqual([{ projectId: 'p1', messageId: 'm1', action: 'Ignore' }]);
        expect(toasts()).toHaveLength(0);
    });

    test('is an error for a type that is an error or a warning', () => {
        ask('m1', 2);

        expect(toasts()[0]?.kind).toBe('error');
    });

    test('answers null when it is dismissed, and only once', async () => {
        ask('m1');
        const [toast] = toasts();
        useToasts.getState().dismiss(toast!.id);
        toast!.actions![0]!.run();
        await settle();

        expect(transport.callsOf('language.messageAnswer').map((call) => call.payload)).toEqual([{ projectId: 'p1', messageId: 'm1', action: null }]);
    });

    test('goes away without an answer when the machine says it was settled', async () => {
        ask('m1');
        transport.emit('language.messageClosed', { projectId: 'p1', messageId: 'm1' });
        await settle();

        expect(toasts()).toHaveLength(0);
        expect(transport.callsOf('language.messageAnswer')).toHaveLength(0);
    });

    test('sends nothing to a machine that does not take answers', async () => {
        transport.connection = { ...transport.connection, features: [] };
        ask('m1');
        toasts()[0]!.actions![0]!.run();
        await settle();

        expect(transport.callsOf('language.messageAnswer')).toHaveLength(0);
    });
});

describe('a document a server shows', () => {
    test('opens a file of the project at the line of its selection', () => {
        const selection = { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } };
        transport.emit('language.show', { projectId: 'p1', server: 'typescript', title: 'typescript', path: 'src/a.ts', selection });
        transport.emit('language.show', { projectId: 'p1', server: 'typescript', title: 'typescript', path: 'src/b.ts' });

        expect(opened).toEqual([
            { folder, path: '/work/app/src/a.ts', line: 5 },
            { folder, path: '/work/app/src/b.ts', line: 1 }
        ]);
        expect(toasts()).toHaveLength(0);
    });

    test('offers a web address and opens nothing until Open is pressed', () => {
        const calls: string[] = [];
        // The unit run has no window; the browser fallback of the system browser opens a tab through this one.
        Object.assign(globalThis, {
            window: {
                open: (url: string) => {
                    calls.push(url);
                    return null;
                }
            }
        });
        try {
            transport.emit('language.show', { projectId: 'p1', server: 'typescript', title: 'typescript', url: 'https://example.com/docs' });

            expect(toasts()[0]).toMatchObject({
                kind: 'success',
                persist: true,
                title: 'TypeScript wants to open a web page',
                description: 'https://example.com/docs'
            });
            expect(calls).toEqual([]);

            toasts()[0]!.action!.run();

            expect(calls).toEqual(['https://example.com/docs']);
        } finally {
            delete (globalThis as { window?: unknown }).window;
        }
    });

    test('ignores an address that is no web page', () => {
        transport.emit('language.show', { projectId: 'p1', server: 'typescript', title: 'typescript', url: 'mailto:a@example.com' });

        expect(toasts()).toHaveLength(0);
    });
});
