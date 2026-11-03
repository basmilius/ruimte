import { describe, expect, test } from 'bun:test';
import { compileUi } from '@adecore/intelligent-ui';
import type { ChatItem, ChatWorkflowAgent, ContextSource, DeviceInfo, DiagramDocument, DrawingElement, Plan, ProjectCanvasView } from '@ruimte/contracts';
import type { CanvasHost } from '../tools/host.ts';
import { catalog } from '../mcp/catalog.ts';
import { callTool } from '../mcp/mcp-route.ts';
import { ContextStore, MAX_SCREEN_LINES, renderTranscript } from './context-store.ts';
import type { ChatUsageInfo } from './chat-usage.ts';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import { artifactReport } from '../artifacts/artifact-report.ts';
import { ArtifactError } from '../artifacts/artifact-names.ts';

interface ToolAnswer {
    refused: boolean;
    text: string;
}

/* The context tools in front of a store, for a caller no project places: `list` and `read` never ask where it stands. */
function toolsOf(context: ContextStore): (name: string, input?: Record<string, unknown>) => Promise<ToolAnswer> {
    const host = {
        projects: { locate: () => null, machineOfNode: () => null },
        context
    } as unknown as CanvasHost;

    return async (name, input = {}) => {
        const result = await callTool(catalog(), name, input, { caller: 'agent', host, files: () => Promise.reject(new Error('no files in these tests')) });
        const first = result.content[0];

        return { refused: result.isError === true, text: first?.type === 'text' ? first.text : '' };
    };
}

/* A store whose readers answer nothing, but for those a test hands it. */
function storeWith(readers: Partial<ConstructorParameters<typeof ContextStore>[0]>): ContextStore {
    return new ContextStore({
        sources: () => [],
        terminalText: async () => null,
        chatItems: () => null,
        drawingElements: async () => null,
        diagramDocument: async () => null,
        ...readers
    });
}

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

/* The canvas the agent stands on, so a refused read can say what the id it was given is. */
const canvas: ProjectCanvasView = {
    id: 'main',
    name: 'Canvas',
    kind: 'canvas',
    nodes: [
        { id: 'agent', kind: 'chat', title: 'planner', x: 0, y: 0, w: 400, h: 300 },
        { id: 'term', kind: 'terminal', title: 'dev server', x: 0, y: 0, w: 400, h: 300 }
    ],
    texts: [],
    edges: [{ id: 'edge-1', from: 'agent', to: 'term' }],
    layouts: []
};

const phone: DeviceInfo = {
    deviceId: 'C0FFEE-1234',
    backendId: 'ios-simulator',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 17 Pro',
    runtime: 'iOS 26.2',
    state: 'booted',
    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
};

const store = new ContextStore({
    sources: (targetId) => linked.get(targetId) ?? [],
    terminalText: async (id) => (id === 'term' ? `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}` : null),
    chatItems: (id) => (id === 'chat' ? items : null),
    browserPage: async (id) => {
        if (id === 'page') {
            return { url: 'https://ruimte.app/notes', text: 'Release notes\n\nEverything is new.' };
        }
        return id === 'moved' ? { url: 'https://ruimte.app/now', text: null } : null;
    },
    devices: async () => [phone],
    drawingElements: async (id) => (id === 'view-1' ? drawing : null),
    // Only the agent of the project that holds it reads the diagram, which is what the daemon's reader does too.
    diagramDocument: async (targetId, id) => (targetId === 'agent' && id === 'flow-1' ? diagram : null),
    canvasOf: (targetId) => (targetId === 'agent' ? canvas : null)
});

const tool = toolsOf(store);

function read(id: string, input: Record<string, unknown> = {}): Promise<ToolAnswer> {
    return tool('context_read', { id, ...input });
}

describe('ContextStore', () => {
    test('a source handed over with no line is read like a linked one, and one with nothing in it says so', async () => {
        linked.set('viewer', []);
        expect(await store.answerSource('viewer', { id: 'term', kind: 'terminal', title: 'dev server' }, 1, null)).toEqual({ text: 'line 2499' });
        await expect(store.answerSource('viewer', { id: 'gone', kind: 'terminal', title: 'old' }, null, null)).rejects.toMatchObject({
            code: 'unreadable',
            message: 'gone is there, but there is nothing to read in it right now'
        });
    });

    test('a file answers its path and a line telling the agent to read it itself', async () => {
        linked.set('agent', [{ id: 'node-1', kind: 'file', title: 'README.md', text: '/home/bas/app/README.md' }]);
        expect(store.list('agent')).toEqual([{ id: 'node-1', kind: 'file', title: 'README.md' }]);
        const read = await store.read('agent', 'node-1');
        expect(read).toContain('/home/bas/app/README.md');
        expect(read).toContain('Read it with your own tools');
        expect(read!.split('\n')).toHaveLength(3);
    });

    test('a browser answers its address and the text of the page this machine has open', async () => {
        linked.set('agent', [{ id: 'page', kind: 'browser', title: 'Release notes', text: 'https://ruimte.app/notes' }]);
        expect(store.list('agent')).toEqual([{ id: 'page', kind: 'browser', title: 'Release notes' }]);
        const read = (await store.read('agent', 'page')) ?? '';
        expect(read.split('\n')[0]).toBe('# Page: https://ruimte.app/notes');
        expect(read).toContain('Everything is new.');
        expect(await store.read('agent', 'page', 1)).toBe('# Page: https://ruimte.app/notes\n\nEverything is new.');
    });

    test('a browser no page is open for says so, and keeps its address', async () => {
        linked.set('agent', [{ id: 'closed', kind: 'browser', title: 'Docs', text: 'https://ruimte.app' }]);
        const read = (await store.read('agent', 'closed')) ?? '';
        expect(read).toContain('https://ruimte.app');
        expect(read).toContain('No page of this node is open on this machine');
    });

    test('a browser open elsewhere reads under the address it is at now, and says when it gave no text', async () => {
        linked.set('agent', [{ id: 'moved', kind: 'browser', title: 'Docs', text: 'https://ruimte.app/start' }]);
        const read = (await store.read('agent', 'moved')) ?? '';
        expect(read.split('\n')[0]).toBe('# Page: https://ruimte.app/now');
        expect(read).toContain('The page is open, but it did not give its text');
    });

    test('a device is looked up among the devices this machine has, ids and all', async () => {
        const device = { platform: 'ios', kind: 'simulator', name: 'iPhone 17 Pro', runtime: 'iOS 26.2' } as const;
        linked.set('agent', [{ id: 'phone', kind: 'device', title: 'iPhone 17 Pro', device }]);
        expect(store.list('agent')).toEqual([{ id: 'phone', kind: 'device', title: 'iPhone 17 Pro' }]);
        const read = (await store.read('agent', 'phone')) ?? '';
        expect(read).toContain('state: booted');
        expect(read).toContain('deviceId: C0FFEE-1234');
        expect(read).toContain('backendId: ios-simulator');
    });

    test('a device this machine does not have says so instead of naming ids it has not got', async () => {
        const device = { platform: 'ios', kind: 'physical', name: 'Bas iPhone', runtime: 'iOS 27.0' } as const;
        linked.set('agent', [{ id: 'gone', kind: 'device', title: 'Bas iPhone', device }]);
        const read = (await store.read('agent', 'gone')) ?? '';
        expect(read).toContain('# Device: Bas iPhone');
        expect(read).toContain('has no such device right now');
        expect(read).not.toContain('deviceId:');
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

    test('tail is the last lines of each kind, and every kind really gets shorter', async () => {
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

    test('the context tools list and read what is linked', async () => {
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }]);
        expect(await tool('context_list')).toEqual({ refused: false, text: 'note\ttext\tSprint\t-\t-' });
        expect(await read('note')).toEqual({ refused: false, text: 'ship it' });
        expect((await read('other')).refused).toBe(true);
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'one\ntwo' }]);
        expect(await read('note', { tail: 1 })).toEqual({ refused: false, text: 'two' });
        expect((await read('note', { tail: 0 })).text).toStartWith('refused bad-arguments:');
        expect((await read('note', { tail: 'two' })).text).toStartWith('refused bad-arguments:');
    });

    test('a read that finds nothing answers why, from the canvas the agent cannot see', async () => {
        linked.set('agent', [{ id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }]);
        const refused = await read('term');
        expect(refused.refused).toBe(true);
        expect(refused.text.split('\n')[0]).toStartWith('refused not-linked: term is a terminal node on main with a line from you into it');
        expect(refused.text).toInclude('link_new');
        // An id the canvas does not carry either is refused with what is linked under it.
        expect((await read('other')).text.split('\n')).toEqual([
            'refused unknown-source: other is not linked to this session, and no node of main carries that id either',
            'note\ttext\tSprint'
        ]);
    });

    test('a linked chat reads its plans above the thread, and a tail never cuts them off', async () => {
        const plan: Plan = {
            id: 'plan-1',
            rev: 2,
            createdAt: '2026-09-16T13:40:00Z',
            meta: { title: 'Ship it', kind: 'steps', checks: 'anyone' },
            items: [{ type: 'step', id: 'build', title: 'Build', state: 'done', by: 'agent', at: '2026-09-16T13:41:00Z' }]
        };
        const withPlans = storeWith({
            sources: () => [{ id: 'chat', kind: 'chat', title: 'Child' }],
            chatItems: (id) => (id === 'chat' ? items : null),
            chatPlans: async (id) => (id === 'chat' ? [plan] : [])
        });
        const whole = await withPlans.read('agent', 'chat');
        expect(whole).toStartWith('Plan "Ship it" (plan-1, steps, rev 2): 1 of 1 done');
        expect(whole).toContain('[x] 1 Build [build]');
        expect(whole).toEndWith(renderTranscript(items));
        const tailed = await withPlans.read('agent', 'chat', 1);
        expect(tailed).toStartWith('Plan "Ship it"');
        expect(tailed).toEndWith('\n\nDone.');
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

describe('a chat read with its usage', () => {
    const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);
    const info: ChatUsageInfo = {
        provider: 'claude',
        model: 'claude-opus-4-5',
        selection: { model: 'opus', options: {} },
        usage: { contextTokens: 50_000, contextWindow: 200_000, costUsd: 0.4, turns: 3, cacheTtlMs: 300_000, cacheExpiresAt: NOW + 252_000 }
    };
    const withUsage = storeWith({
        sources: () => [
            { id: 'chat', kind: 'chat', title: 'Child' },
            { id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }
        ],
        chatItems: (id) => (id === 'chat' ? items : null),
        chatInfo: (id) => (id === 'chat' ? info : null),
        subagentItems: async () => items,
        now: () => NOW
    });

    test('starts with one line of model, context and prompt cache, and a tail keeps it', async () => {
        const line =
            '> Usage: claude claude-opus-4-5, context 50000 of 200000 tokens (25%), prompt cache warm for 4m 12s more (until 2026-10-22T10:04:12.000Z, lifetime 5m 0s)';
        expect(await withUsage.read('agent', 'chat')).toBe(`${line}\n\n${renderTranscript(items)}`);
        expect(await withUsage.read('agent', 'chat', 1)).toBe(`${line}\n\nDone.`);
    });

    test('answers the same numbers beside the text, and none for a subagent or another kind', async () => {
        const reading = await withUsage.answer('agent', 'chat', null, null);
        expect(reading.usage).toEqual({
            provider: 'claude',
            model: 'claude-opus-4-5',
            contextTokens: 50_000,
            contextWindow: 200_000,
            contextPercent: 25,
            cache: { ttlMs: 300_000, expiresAt: '2026-10-22T10:04:12.000Z', expiresInMs: 252_000, expired: false }
        });
        expect((await withUsage.answer('agent', 'chat', null, 'toolu_1')).usage).toBeUndefined();
        expect(await withUsage.answer('agent', 'note', null, null)).toEqual({ text: 'ship it' });
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

    test('a Workflow row lists each phase with its agents, their state and the id a subagent read takes', () => {
        const workflow = (name: string | null, agents: ChatWorkflowAgent[]): ChatItem => ({
            id: 'wf',
            kind: 'tool',
            createdAt: 1,
            turnId: 't',
            toolUseId: 'toolu_wf',
            name: 'Workflow',
            input: { script: 'export const meta = { name: "write-and-read" }' },
            output: null,
            state: 'running',
            parentToolUseId: null,
            workflow: {
                name,
                phases: [
                    { index: 1, title: 'Write' },
                    { index: 2, title: 'Read' },
                    { index: 3, title: 'Check' }
                ],
                agents
            }
        });
        const agent = (
            index: number,
            label: string,
            phaseIndex: number | null,
            agentId: string | null,
            status: ChatWorkflowAgent['status']
        ): ChatWorkflowAgent => ({
            index,
            label,
            phaseIndex,
            agentId,
            status,
            startedAt: null,
            durationMs: null,
            lastTool: null
        });
        const text = renderTranscript([
            workflow('write-and-read', [
                agent(1, 'write-file', 1, 'a-writer', 'done'),
                agent(2, 'read-file', 2, 'a-reader', 'running'),
                agent(3, 'read-again', 2, null, 'running'),
                agent(4, 'tidy', null, 'a-tidy', 'failed')
            ])
        ]);
        expect(text.split('\n').slice(1)).toEqual([
            'Workflow "write-and-read", each agent readable with subagent and the id beside it:',
            '- phase 1 "Write": write-file (done, workflow-agent:a-writer)',
            '- phase 2 "Read": read-file (running, workflow-agent:a-reader), read-again (running, not started yet)',
            '- phase 3 "Check": not started yet',
            '- outside a phase: tidy (failed, workflow-agent:a-tidy)'
        ]);
        expect(renderTranscript([workflow(null, [])]).split('\n')[1]).toBe('Workflow, each agent readable with subagent and the id beside it:');
    });
});

describe('a request in a thread', () => {
    const question = (state: 'pending' | 'answered', answers: Record<string, string> | null): ChatItem => ({
        id: 'question-req-1',
        kind: 'question',
        createdAt: 1,
        turnId: 't',
        requestId: 'req-1',
        questions: [
            {
                id: 'color',
                header: 'Color',
                question: 'Welke kleur?',
                choices: [
                    { label: 'Rood', description: '' },
                    { label: 'Blauw', description: 'the calm one' }
                ],
                multiSelect: false
            },
            { id: 'name', header: 'Name', question: 'Which name?', choices: [], multiSelect: false }
        ],
        answers,
        state
    });

    const approval = (decision: 'pending' | 'allow'): ChatItem => ({
        id: 'approval-req-2',
        kind: 'approval',
        createdAt: 2,
        turnId: 't',
        requestId: 'req-2',
        toolUseId: 'toolu_9',
        toolName: 'Write',
        input: { file_path: 'a.ts' },
        description: 'Write a.ts',
        canAllowAlways: false,
        decision
    });

    test('a waiting question shows its request id, and the question ids and choices answer takes', () => {
        expect(renderTranscript([question('pending', null)])).toBe(
            [
                '> Question (waits for an answer, request req-1): Welke kleur? / Which name?',
                '- question color: choices Rood | Blauw, or your own words',
                '- question name: answer in your own words'
            ].join('\n')
        );
    });

    test('an answered question keeps its id and says it was answered, with nothing left to pick', () => {
        expect(renderTranscript([question('answered', { color: 'Blauw', name: 'Kees' })])).toBe(
            '> Question (answered, request req-1): Welke kleur? / Which name? -> Blauw, Kees'
        );
    });

    test('an approval shows its request id and who it waits for, and what came of it', () => {
        expect(renderTranscript([approval('pending')])).toBe('> Approval (waits for a person, request req-2): Write: Write a.ts');
        expect(renderTranscript([approval('allow')])).toBe('> Approval (allowed, request req-2): Write: Write a.ts');
    });
});

describe('a subagent of a linked chat', () => {
    const subagentStore = storeWith({
        sources: () => [
            { id: 'chat', kind: 'chat', title: 'planner' },
            { id: 'note', kind: 'text', title: 'Sprint', text: 'ship it' }
        ],
        chatItems: (id) => (id === 'chat' ? items : null),
        subagentItems: async (chatId, toolUseId) => {
            if (chatId !== 'chat' || toolUseId !== 'toolu_1') {
                throw new Error('Claude has not written a transcript for this subagent');
            }
            return [
                { id: 'p', kind: 'user', createdAt: 1, turnId: null, text: 'Survey the docs' },
                { id: 'r', kind: 'assistant', createdAt: 2, turnId: null, text: 'A guide is missing.', streaming: false }
            ];
        }
    });

    const ask = toolsOf(subagentStore);

    test('subagent prints that conversation through the chat it belongs to, and tail counts its lines', async () => {
        expect(await ask('context_read', { id: 'chat', subagent: 'toolu_1' })).toEqual({
            refused: false,
            text: '## User\n\nSurvey the docs\n\n## Assistant\n\nA guide is missing.'
        });
        expect((await ask('context_read', { id: 'chat', subagent: 'toolu_1', tail: 1 })).text).toBe('A guide is missing.');
    });

    test('a subagent that is not there, or asked of something that is no chat, is refused with why', async () => {
        expect(await ask('context_read', { id: 'chat', subagent: 'toolu_2' })).toEqual({
            refused: true,
            text: 'refused unknown-subagent: Claude has not written a transcript for this subagent'
        });
        expect(await ask('context_read', { id: 'note', subagent: 'toolu_1' })).toEqual({
            refused: true,
            text: 'refused unknown-subagent: note is a text, and only a chat has subagents'
        });
        expect((await ask('context_read', { id: 'nope', subagent: 'toolu_1' })).text).toStartWith('refused unknown-source:');
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

    test('tail counts the reading order alone and never reaches the SVG', async () => {
        linked.set('agent', [{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        expect(await store.read('agent', 'flow-1', 2)).toBe('Daemon -> Disk\nMachine wraps: Daemon, Disk');
        // A tail longer than the list is the whole list and still no heading and no markup.
        expect(await store.read('agent', 'flow-1', 100)).toBe(
            'Client (React)\nDaemon\nDisk\nClient -> Daemon: socket\nDaemon -> Disk\nMachine wraps: Daemon, Disk'
        );
        expect((await read('flow-1', { tail: 1 })).text).toBe('Machine wraps: Daemon, Disk');
    });

    test('the node it is linked through reads it too, and lists under the view id alone', async () => {
        linked.set('agent', [{ id: 'flow-1', kind: 'diagram', title: 'Wire', nodeId: 'diagram-node' }]);
        expect(store.list('agent')).toEqual([{ id: 'flow-1', kind: 'diagram', title: 'Wire' }]);
        expect(await read('diagram-node')).toEqual(await read('flow-1'));
        expect((await read('diagram-node', { tail: 1 })).text).toBe('Machine wraps: Daemon, Disk');
        // A node nothing links into the asker stays unreadable, whatever it mirrors.
        expect((await read('other-node')).refused).toBe(true);
    });

    test('a diagram the daemon cannot find reads as nothing at all', async () => {
        linked.set('agent', [{ id: 'gone', kind: 'diagram', title: 'Wire' }]);
        expect(await store.read('agent', 'gone')).toBeNull();
        expect((await read('gone')).refused).toBe(true);
    });
});

test('reading an assistant UI block returns its fallback between the surrounding prose', () => {
    const text = 'Before\n```ruimte-ui\n<Summary>Readable result</Summary>\n```\nAfter';
    const item: ChatItem = {
        id: 'reply',
        kind: 'assistant',
        createdAt: 1,
        turnId: null,
        text,
        streaming: false,
        ui: compileUi(text, { id: 'reply', final: true, fenceLanguage: RUIMTE_UI_FENCE, now: () => 0 })
    };
    const transcript = renderTranscript([item]);
    expect(transcript).toContain('Before');
    expect(transcript).toContain('Readable result');
    expect(transcript).toContain('After');
    expect(transcript).not.toContain('ruimte-ui');
    expect(transcript).not.toContain('<Summary>');
});

test('a transcript retains the intent of a chosen UI action without changing the visible message', () => {
    const item: ChatItem = {
        id: 'user-choice',
        kind: 'user',
        createdAt: 2,
        turnId: 'turn',
        text: 'The selected files',
        uiChoice: { itemId: 'reply', blockId: 'block', revision: 'revision', choiceId: 'choice', label: 'Fix errors', sourceAt: 1, older: false, at: 2 }
    };
    expect(renderTranscript([item])).toContain('Chose "Fix errors"\n\nThe selected files');
    expect(item.text).toBe('The selected files');
});

describe('an artifact node read', () => {
    const versions = ['ver-2', 'ver-1'].map((versionId, index) => ({
        versionId,
        number: 2 - index,
        createdAt: 0,
        files: [{ name: 'summary.md', mime: 'text/markdown', size: 6, sha256: versionId }],
        bytes: 6,
        provenance: { maker: 'agent' as const, machineId: 'machine-1' },
        copiedTo: []
    }));
    // Output as `Artifacts.read` answers: only the project it is asked for, and a version by id or the latest.
    const output = {
        read: async (projectId: string, query: { artifactId: string; versionId?: string }) => {
            const version = query.versionId === undefined ? versions[0] : versions.find((entry) => entry.versionId === query.versionId);
            if (projectId !== 'p1' || query.artifactId !== 'art-1' || version === undefined) {
                throw new ArtifactError('not-found', 'No such artifact in this project');
            }
            const artifact = { artifactId: 'art-1', projectId, projectName: 'One', title: 'Morning summary', kind: 'report', createdAt: 0 };
            return { artifact, version, file: version.files[0]!, text: `version ${version.number}`, truncated: false };
        }
    };
    const projectOf: Record<string, string> = { agent: 'p1', stranger: 'p2' };
    const sources: ContextSource[] = [
        { id: 'latest', kind: 'artifact', title: 'Morning summary', artifact: { id: 'art-1' } },
        { id: 'pinned', kind: 'artifact', title: 'Morning summary', artifact: { id: 'art-1', version: 'ver-1' } }
    ];
    const reading = storeWith({
        sources: () => sources,
        artifactReport: async (targetId, artifact) => (projectOf[targetId] ? artifactReport(output, projectOf[targetId], artifact) : null)
    });

    test('gives the version the node shows, the latest when it follows', async () => {
        expect(await reading.read('agent', 'latest')).toEndWith('\n\nversion 2');
        const pinned = (await reading.read('agent', 'pinned')) ?? '';
        expect(pinned).toContain('pinned\tthis version, whatever is newer');
        expect(pinned).toEndWith('\n\nversion 1');
    });

    test("reads nothing of another project's Output", async () => {
        expect(await reading.read('stranger', 'latest')).toBeNull();
    });
});

describe('a routine node read', () => {
    const sources: ContextSource[] = [{ id: 'morning-node', kind: 'routine', title: 'Morning summary', routine: 'morning' }];
    const reading = storeWith({
        sources: () => sources,
        routineReport: async (targetId, routineId) => (targetId === 'agent' && routineId === 'morning' ? 'routine\tmorning\nrun\trun-1' : null)
    });

    test("gives the report of the node's routine, and tail counts its lines", async () => {
        expect(await reading.read('agent', 'morning-node')).toEndWith('routine\tmorning\nrun\trun-1');
        expect(await reading.read('agent', 'morning-node', 1)).toEndWith('run\trun-1');
        expect(await reading.read('stranger', 'morning-node')).toBeNull();
    });
});
