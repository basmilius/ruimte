import { describe, expect, test } from 'bun:test';
import type { ChatItem, ContextSource, DrawingElement } from '@ruimte/contracts';
import { ContextStore, MAX_SCREEN_LINES, renderTranscript } from './context-store.ts';

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

const drawing: DrawingElement[] = [
    { kind: 'rect', id: 'el-1', x: 0, y: 0, w: 120, h: 60, stroke: 'ink', strokeWidth: 2, seed: 4 },
    { kind: 'text', id: 'el-2', x: 10, y: 20, w: 80, h: 24, stroke: 'ink', strokeWidth: 1, seed: 5, text: 'Client', size: 20 }
];

// Stands in for the project index: what each target's document links into it.
const linked = new Map<string, ContextSource[]>();

const store = new ContextStore({
    sources: (targetId) => linked.get(targetId) ?? [],
    terminalText: async (id) => (id === 'term' ? `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}` : null),
    chatItems: (id) => (id === 'chat' ? items : null),
    drawingElements: async (id) => (id === 'view-1' ? drawing : null),
    targetForToken: (token) => (token === 'tok' ? 'agent' : null)
});

const get = (path: string, token?: string) => {
    const url = new URL(`http://127.0.0.1${path}`);
    return store.handle(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }), url.pathname);
};

describe('ContextStore', () => {
    test('a file answers its path and a line telling the agent to read it itself', async () => {
        linked.set('agent', [{ id: 'node-1', kind: 'file', title: 'README.md', text: '/home/bas/app/README.md' }]);
        expect(store.list('agent')).toEqual([{ id: 'node-1', kind: 'file', title: 'README.md' }]);
        const read = await store.read('agent', 'node-1');
        expect(read).toContain('/home/bas/app/README.md');
        expect(read).toContain('Read it with your own tools');
    });

    test('lists what the document links, without the text bodies, and reads each kind', async () => {
        linked.set('agent', [
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

    test('--tail is the last lines of each kind, and the screen cap stays the ceiling', async () => {
        linked.set('agent', [
            { id: 'note', kind: 'text', title: 'Sprint', text: 'one\ntwo\nthree' },
            { id: 'term', kind: 'terminal', title: 'dev server' },
            { id: 'chat', kind: 'chat', title: 'planner' },
            { id: 'view-1', kind: 'drawing', title: 'Sketch' }
        ]);
        expect(await store.read('agent', 'note', 2)).toBe('two\nthree');
        const screen = (await store.read('agent', 'term', 15)) ?? '';
        expect(screen.split('\n')).toHaveLength(15);
        expect(screen.endsWith('line 2499')).toBe(true);
        // Past the cap it reads what the daemon keeps, not what was asked for.
        expect(((await store.read('agent', 'term', 9000)) ?? '').split('\n')).toHaveLength(MAX_SCREEN_LINES);
        expect(await store.read('agent', 'chat', 1)).toBe('Done.');
        // A drawing tails its reading order; the picture is the expensive half and stays behind.
        const sketch = (await store.read('agent', 'view-1', 5)) ?? '';
        expect(sketch).toContain('Client');
        expect(sketch).not.toContain('<svg');
    });

    test('the HTTP face checks the token and answers list and read', async () => {
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }]);
        expect((await get('/context')).status).toBe(401);
        expect((await get('/context', 'wrong')).status).toBe(401);
        expect(await (await get('/context', 'tok')).json()).toEqual({ sources: [{ id: 'note', kind: 'text', title: 'Sprint' }] });
        expect(await (await get('/context/note', 'tok')).text()).toBe('ship it');
        expect((await get('/context/other', 'tok')).status).toBe(404);
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'one\ntwo' }]);
        expect(await (await get('/context/note?tail=1', 'tok')).text()).toBe('two');
        expect((await get('/context/note?tail=0', 'tok')).status).toBe(400);
        expect((await get('/context/note?tail=two', 'tok')).status).toBe(400);
    });

    test('a file answers with its path and never with its bytes', async () => {
        linked.set('agent', [{ id: 'node-1', kind: 'file', title: 'main.ts', text: '/repo/src/main.ts' }]);
        expect(store.list('agent')).toEqual([{ id: 'node-1', kind: 'file', title: 'main.ts' }]);
        const answer = (await store.read('agent', 'node-1')) ?? '';
        expect(answer).toContain('/repo/src/main.ts');
        expect(answer.split('\n')).toHaveLength(3);
    });

    test('a target has context only while something is linked into it', () => {
        linked.set('agent', [{ id: 'x', kind: 'text', title: 'x', text: '' }]);
        expect(store.has('agent')).toBe(true);
        linked.set('agent', []);
        expect(store.has('agent')).toBe(false);
        expect(store.list('agent')).toEqual([]);
        expect(store.has('stranger')).toBe(false);
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

describe('a drawing as context', () => {
    test('an agent reads the texts first and the picture after them', async () => {
        linked.set('agent', [{ id: 'view-1', kind: 'drawing', title: 'Sketch' }]);
        const text = await store.read('agent', 'view-1');
        expect(text).toContain('Client');
        expect(text?.indexOf('Client')).toBeLessThan(text!.indexOf('## SVG'));
        expect(text).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    });

    test('a drawing whose project is closed reads as nothing at all', async () => {
        linked.set('agent', [{ id: 'gone', kind: 'drawing', title: 'Sketch' }]);
        expect(await store.read('agent', 'gone')).toBeNull();
    });
});
