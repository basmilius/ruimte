import { describe, expect, test } from 'bun:test';
import type { ChatItem, ContextSource, DiagramDocument, DrawingElement, Plan } from '@ruimte/contracts';
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
    { kind: 'text', id: 'el-2', x: 10, y: 20, w: 80, h: 24, stroke: 'ink', strokeWidth: 1, seed: 5, text: 'Client', size: 20 },
    { kind: 'text', id: 'el-3', x: 10, y: 220, w: 80, h: 24, stroke: 'ink', strokeWidth: 1, seed: 6, text: 'Daemon', size: 20 },
    { kind: 'text', id: 'el-4', x: 10, y: 420, w: 80, h: 24, stroke: 'ink', strokeWidth: 1, seed: 7, text: 'Disk', size: 20 }
];

const diagram: DiagramDocument = {
    version: 1,
    rev: 3,
    meta: { title: 'Wire', direction: 'right' },
    nodes: [
        { id: 'client', label: 'Client', sub: 'React' },
        { id: 'daemon', label: 'Daemon' },
        { id: 'disk', label: 'Disk', shape: 'cylinder' }
    ],
    groups: [{ id: 'machine', label: 'Machine', wraps: ['daemon', 'disk'] }],
    edges: [
        { from: 'client', to: 'daemon', label: 'socket' },
        { from: 'daemon', to: 'disk' }
    ]
};

// Stands in for the project index: what each target's document links into it.
const linked = new Map<string, ContextSource[]>();

const store = new ContextStore({
    sources: (targetId) => linked.get(targetId) ?? [],
    terminalText: async (id) => (id === 'term' ? `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}` : null),
    chatItems: (id) => (id === 'chat' ? items : null),
    drawingElements: async (id) => (id === 'view-1' ? drawing : null),
    // Only the agent of the project that holds it reads the diagram, which is what the daemon's reader does too.
    diagramDocument: async (targetId, id) => (targetId === 'agent' && id === 'flow-1' ? diagram : null),
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

    test('--tail is the last lines of each kind, and every kind really gets shorter', async () => {
        linked.set('agent', [
            { id: 'note', kind: 'text', title: 'Sprint', text: Array.from({ length: 10 }, (_, i) => `note line ${i}`).join('\n') },
            { id: 'term', kind: 'terminal', title: 'dev server' },
            { id: 'chat', kind: 'chat', title: 'planner' },
            { id: 'view-1', kind: 'drawing', title: 'Sketch' }
        ]);
        /* Every kind is read whole first, so the tail is held against a source that really is
           longer than it: a source of two lines would pass a tail that does nothing at all. */
        const whole = async (id: string): Promise<string[]> => ((await store.read('agent', id)) ?? '').split('\n');
        const tail = async (id: string, count: number): Promise<string[]> => ((await store.read('agent', id, count)) ?? '').split('\n');

        expect(await whole('note')).toHaveLength(10);
        expect(await tail('note', 3)).toEqual(['note line 7', 'note line 8', 'note line 9']);

        expect(await whole('term')).toHaveLength(MAX_SCREEN_LINES);
        const screen = await tail('term', 15);
        expect(screen).toHaveLength(15);
        expect(screen.at(-1)).toBe('line 2499');
        // Past the cap it reads what the daemon keeps, not what was asked for.
        expect(await tail('term', 9000)).toHaveLength(MAX_SCREEN_LINES);

        const thread = await whole('chat');
        expect(thread.length).toBeGreaterThan(3);
        expect(await tail('chat', 3)).toEqual(thread.slice(-3));

        // A drawing tails its reading order; the picture is the expensive half and stays behind.
        const reading = ['Client', 'Daemon', 'Disk'];
        expect(await whole('view-1')).toContain('## SVG');
        expect(await tail('view-1', 2)).toEqual(reading.slice(-2));
        expect((await store.read('agent', 'view-1', 2)) ?? '').not.toContain('<svg');
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

    test('a linked chat reads its plans above the thread, and a tail never cuts them off', async () => {
        const plan: Plan = {
            id: 'plan-1',
            rev: 2,
            createdAt: '2026-09-16T13:40:00Z',
            meta: { title: 'Ship it', kind: 'steps', checks: 'anyone' },
            items: [{ type: 'step', id: 'build', title: 'Build', state: 'done', by: 'agent', at: '2026-09-16T13:41:00Z' }]
        };
        const withPlans = new ContextStore({
            sources: () => [{ id: 'chat', kind: 'chat', title: 'Child' }],
            terminalText: async () => null,
            chatItems: (id) => (id === 'chat' ? items : null),
            chatPlans: async (id) => (id === 'chat' ? [plan] : []),
            drawingElements: async () => null,
            diagramDocument: async () => null,
            targetForToken: () => null
        });
        const whole = await withPlans.read('agent', 'chat');
        expect(whole).toStartWith('Plan "Ship it" (plan-1, steps, rev 2): 1 of 1 done');
        expect(whole).toContain('[x] 1 Build [build]');
        expect(whole).toEndWith(renderTranscript(items));
        const tailed = await withPlans.read('agent', 'chat', 1);
        expect(tailed).toStartWith('Plan "Ship it"');
        expect(tailed).toEndWith('\n\nDone.');
    });

    test('a file answers with its path and never with its bytes', async () => {
        linked.set('agent', [{ id: 'node-1', kind: 'file', title: 'main.ts', text: '/repo/src/main.ts' }]);
        expect(store.list('agent')).toEqual([{ id: 'node-1', kind: 'file', title: 'main.ts' }]);
        const answer = (await store.read('agent', 'node-1')) ?? '';
        expect(answer).toContain('/repo/src/main.ts');
        expect(answer.split('\n')).toHaveLength(3);
    });

    test('remembers what an agent was told, so the next turn hears what moved', () => {
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }]);
        // The first answer carries the whole list, so there is nothing to report as a change.
        expect(store.changeSince('agent')).toBeNull();
        expect(store.changeSince('agent')).toBeNull();
        linked.set('agent', [
            { id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' },
            { id: 'term', kind: 'terminal', title: 'dev server' }
        ]);
        expect(store.changeSince('agent')).toContain('Added: "dev server" (terminal).');
        expect(store.changeSince('agent')).toBeNull();
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

    test('a subagent is one line, and nothing it did reads as if the parent did it', () => {
        const text = renderTranscript([
            { id: 'u', kind: 'user', createdAt: 1, turnId: 't', text: 'look around' },
            {
                id: 'sub',
                kind: 'subagent',
                createdAt: 2,
                turnId: 't',
                toolUseId: 'toolu_1',
                description: 'Survey the docs',
                subagentType: null,
                prompt: 'Survey',
                background: false,
                status: 'done',
                startedAt: 2,
                finishedAt: 3,
                summary: null,
                result: '\nA guide is missing.\nAnd more.',
                usage: null,
                lastTool: null,
                itemsTruncated: false
            },
            {
                id: 'child-tool',
                kind: 'tool',
                createdAt: 2,
                turnId: 't',
                toolUseId: 'child-tool',
                name: 'Glob',
                input: { pattern: 'docs/**' },
                output: 'docs/README.md',
                state: 'done',
                parentToolUseId: 'toolu_1'
            },
            { id: 'child-text', kind: 'assistant', createdAt: 2, turnId: 't', text: 'A guide is missing.', streaming: false, parentToolUseId: 'toolu_1' },
            { id: 'a', kind: 'assistant', createdAt: 3, turnId: 't', text: 'The docs need a guide.', streaming: false }
        ]);
        expect(text.split('\n').filter((line) => line.startsWith('> '))).toEqual(['> Subagent "Survey the docs" (done, toolu_1): A guide is missing.']);
        expect(text).not.toContain('Glob');
        expect(text.match(/A guide is missing\./g)).toHaveLength(1);
    });
});

describe('a subagent of a linked chat', () => {
    const subagentStore = new ContextStore({
        sources: () => [
            { id: 'chat', kind: 'chat', title: 'planner' },
            { id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }
        ],
        terminalText: async () => null,
        chatItems: (id) => (id === 'chat' ? items : null),
        subagentItems: async (chatId, toolUseId) => {
            if (chatId !== 'chat' || toolUseId !== 'toolu_1') {
                throw new Error('Claude has not written a transcript for this subagent');
            }
            return [
                { id: 'p', kind: 'user', createdAt: 1, turnId: null, text: 'Survey the docs' },
                { id: 'r', kind: 'assistant', createdAt: 2, turnId: null, text: 'A guide is missing.', streaming: false }
            ];
        },
        drawingElements: async () => null,
        diagramDocument: async () => null,
        targetForToken: (token) => (token === 'tok' ? 'agent' : null)
    });

    const ask = (path: string) => {
        const url = new URL(`http://127.0.0.1${path}`);
        return subagentStore.handle(new Request(url, { headers: { authorization: 'Bearer tok' } }), url.pathname);
    };

    test('--subagent prints that conversation through the chat it belongs to, and --tail counts its lines', async () => {
        expect(await (await ask('/context/chat?subagent=toolu_1')).text()).toBe('## User\n\nSurvey the docs\n\n## Assistant\n\nA guide is missing.');
        expect(await (await ask('/context/chat?subagent=toolu_1&tail=1')).text()).toBe('A guide is missing.');
    });

    test('a subagent that is not there, or asked of something that is no chat, is a 422 that says why', async () => {
        const missing = await ask('/context/chat?subagent=toolu_2');
        expect(missing.status).toBe(422);
        expect(await missing.text()).toBe('Claude has not written a transcript for this subagent');
        const note = await ask('/context/note?subagent=toolu_1');
        expect(note.status).toBe(422);
        expect(await note.text()).toBe('note is a text, and only a chat has subagents');
        expect((await ask('/context/nope?subagent=toolu_1')).status).toBe(404);
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

describe('a diagram as context', () => {
    test('an agent reads the title, the reading order and the SVG after it', async () => {
        linked.set('agent', [{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        expect(store.list('agent')).toEqual([{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        const text = (await store.read('agent', 'flow-1')) ?? '';
        const [head, svg] = text.split('\n## SVG\n');
        expect(head!.split('\n')).toEqual([
            '# Diagram: Wire',
            '',
            'Client (React)',
            'Daemon',
            'Disk',
            'Client -> Daemon: socket',
            'Daemon -> Disk',
            'Machine wraps: Daemon, Disk',
            ''
        ]);
        expect(svg).toContain('<svg');
    });

    test('--tail counts the reading order alone and never reaches the SVG', async () => {
        linked.set('agent', [{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        expect(await store.read('agent', 'flow-1', 2)).toBe('Daemon -> Disk\nMachine wraps: Daemon, Disk');
        // A tail longer than the list is the whole list and still no heading and no markup.
        expect(await store.read('agent', 'flow-1', 100)).toBe(
            'Client (React)\nDaemon\nDisk\nClient -> Daemon: socket\nDaemon -> Disk\nMachine wraps: Daemon, Disk'
        );
        expect(await (await get('/context/flow-1?tail=1', 'tok')).text()).toBe('Machine wraps: Daemon, Disk');
    });

    test('the node it is linked through reads it too, and lists under the view id alone', async () => {
        linked.set('agent', [{ id: 'flow-1', kind: 'diagram', title: 'Wire', nodeId: 'diagram-node' }]);
        expect(store.list('agent')).toEqual([{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        expect(await (await get('/context/diagram-node', 'tok')).text()).toBe(await (await get('/context/flow-1', 'tok')).text());
        expect(await (await get('/context/diagram-node?tail=1', 'tok')).text()).toBe('Machine wraps: Daemon, Disk');
        // A node nothing links into the asker stays unreadable, whatever it mirrors.
        expect((await get('/context/other-node', 'tok')).status).toBe(404);
    });

    test('a diagram the daemon cannot find reads as nothing at all', async () => {
        linked.set('agent', [{ id: 'gone', kind: 'diagram', title: 'Wire' }]);
        expect(await store.read('agent', 'gone')).toBeNull();
        expect((await get('/context/gone', 'tok')).status).toBe(404);
    });
});
