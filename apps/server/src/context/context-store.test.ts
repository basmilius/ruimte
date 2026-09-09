import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { ContextStore, renderTranscript } from './context-store.ts';

const items: ChatItem[] = [
    { id: 'u', kind: 'user', createdAt: 1, turnId: 't', text: 'fix the bug' },
    {
        id: 'tool',
        kind: 'tool',
        createdAt: 2,
        turnId: 't',
        toolUseId: 'tool',
        name: 'Bash',
        input: { command: 'ls' },
        output: 'a.ts',
        state: 'done',
        parentToolUseId: null
    },
    { id: 'a', kind: 'assistant', createdAt: 3, turnId: 't', text: 'Done.', streaming: false }
];

const store = new ContextStore({
    terminalText: async (id) => (id === 'term' ? `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}` : null),
    chatItems: (id) => (id === 'chat' ? items : null),
    targetForToken: (token) => (token === 'tok' ? 'agent' : null)
});

const get = (path: string, token?: string) =>
    store.handle(new Request(`http://127.0.0.1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), path);

describe('ContextStore', () => {
    test('lists what the client set, without the text bodies, and reads each kind', async () => {
        store.set('agent', [
            { id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' },
            { id: 'term', kind: 'terminal', title: 'dev server' },
            { id: 'chat', kind: 'chat', title: 'planner' }
        ]);
        expect(store.list('agent')).toEqual([
            { id: 'note', kind: 'text', title: 'Sprint' },
            { id: 'term', kind: 'terminal', title: 'dev server' },
            { id: 'chat', kind: 'chat', title: 'planner' }
        ]);
        expect(await store.read('agent', 'note')).toBe('ship it');
        const screen = (await store.read('agent', 'term')) ?? '';
        expect(screen.split('\n')).toHaveLength(2000);
        expect(screen.endsWith('line 2499')).toBe(true);
        expect(await store.read('agent', 'chat')).toContain('## User\n\nfix the bug');
        expect(await store.read('agent', 'nope')).toBeNull();
    });

    test('the HTTP face checks the token and answers list and read', async () => {
        store.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }]);
        expect((await get('/context')).status).toBe(401);
        expect((await get('/context', 'wrong')).status).toBe(401);
        expect(await (await get('/context', 'tok')).json()).toEqual({ sources: [{ id: 'note', kind: 'text', title: 'Sprint' }] });
        expect(await (await get('/context/note', 'tok')).text()).toBe('ship it');
        expect((await get('/context/other', 'tok')).status).toBe(404);
    });

    test('an empty set clears the target', () => {
        store.set('agent', [{ id: 'x', kind: 'text', title: 'x', text: '' }]);
        expect(store.has('agent')).toBe(true);
        store.set('agent', []);
        expect(store.has('agent')).toBe(false);
    });
});

describe('renderTranscript', () => {
    test('reads like a conversation with the tool calls in between', () => {
        const text = renderTranscript(items);
        expect(text).toContain('## User');
        expect(text).toContain('> Tool Bash (done): {"command":"ls"}');
        expect(text).toContain('a.ts');
        expect(text.endsWith('Done.')).toBe(true);
    });
});
