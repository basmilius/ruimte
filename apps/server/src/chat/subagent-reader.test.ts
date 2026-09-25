import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflowAgentRef, type ChatInfo, type ChatItem, type ChatSubagentChangedEvent, type ChatSubagentItem } from '@ruimte/contracts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import { claudeProjectSlug } from './claude-transcript.ts';
import type { ThreadItemsParams } from './codex-thread.ts';
import { SubagentReader, type SubagentChat } from './subagent-reader.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'claude-projects');
const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';
const CHILD_CALL = 'toolu_01ParentAgentCall';
const GRANDCHILD_CALL = 'toolu_01ChildAgentCall';
const CHILD_FILE = 'agent-a4c2e8f10b3d5a7e9.jsonl';

let projects: string;
let watch: FakeWatch;
let told: Array<{ clientId: string; event: ChatSubagentChangedEvent }>;
let chats: Map<string, SubagentChat>;
let noted: Array<{ toolUseId: string; native: { agentId?: string; threadId?: string } }>;

const info = (chatId: string, provider: ChatInfo['provider'], agentSessionId: string | null): ChatInfo => ({
    chatId,
    provider,
    cwd: '/work/demo',
    agentSessionId,
    model: null,
    selection: { model: 'm', options: {} },
    runtimeMode: 'full-access',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: 0, costUsd: 0, turns: 0 },
    createdAt: 0
});

const row = (toolUseId: string, patch: Partial<ChatSubagentItem> = {}): ChatSubagentItem => ({
    id: `1:${toolUseId}`,
    kind: 'subagent',
    createdAt: 0,
    turnId: 'turn-1',
    toolUseId,
    description: 'Survey the docs',
    subagentType: 'general-purpose',
    prompt: null,
    background: false,
    status: 'running',
    startedAt: 0,
    finishedAt: null,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: true,
    ...patch
});

const makeReader = (listOnce?: (params: ThreadItemsParams) => Promise<unknown>, now: () => number = () => 0): SubagentReader =>
    new SubagentReader({
        chat: (chatId) => chats.get(chatId) ?? null,
        claudeProjectsDir: projects,
        codexProcess: (chatInfo) => ({ command: ['codex', 'app-server'], cwd: chatInfo.cwd, env: {} }),
        notify: (clientId, event) => told.push({ clientId, event }),
        seams: watch,
        now,
        ...(listOnce ? { listOnce: (_spec, params) => listOnce(params) } : {})
    });

const claudeChat = (items: ChatItem[]): SubagentChat => ({
    info: info('chat-1', 'claude', SESSION),
    running: false,
    items: () => items,
    listThreadItems: () => null,
    noteNative: (toolUseId, native) => noted.push({ toolUseId, native })
});

const subagentsDir = (): string => join(projects, claudeProjectSlug('/work/demo'), SESSION, 'subagents');

const line = (entry: Record<string, unknown>): string => `${JSON.stringify({ isSidechain: true, sessionId: SESSION, version: '2.1.273', ...entry })}\n`;

const toolStep = (step: number): string =>
    line({
        type: 'assistant',
        uuid: `s-${step}-a`,
        timestamp: '2026-09-16T09:00:00.000Z',
        message: {
            id: `msg_step_${step}`,
            role: 'assistant',
            content: [{ type: 'tool_use', id: `toolu_step_${step}`, name: 'Bash', input: { command: `echo ${step}` } }]
        }
    }) +
    line({
        type: 'user',
        uuid: `s-${step}-u`,
        timestamp: '2026-09-16T09:00:01.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_step_${step}`, content: `${step}` }] }
    });

beforeEach(async () => {
    projects = await mkdtemp(join(tmpdir(), 'ruimte-subagents-'));
    await cp(FIXTURE, projects, { recursive: true });
    watch = new FakeWatch();
    told = [];
    noted = [];
    chats = new Map();
});

afterEach(async () => {
    await rm(projects, { recursive: true, force: true });
});

describe('a Claude subagent', () => {
    test('reads the transcript beside the session as the rows of a conversation, and notes which agent it is', async () => {
        chats.set('chat-1', claudeChat([row(CHILD_CALL, { status: 'done' })]));
        const page = await makeReader().read('chat-1', CHILD_CALL);

        expect(page.source).toBe('claude-transcript');
        expect(page.live).toBe(false);
        expect(page.history).toEqual({ start: 0, cursor: null });
        expect(page.items.map((item) => item.kind)).toEqual(['user', 'thinking', 'tool', 'subagent', 'assistant']);
        // What the CLI slipped in (reminders, skill text, attachments) is nobody talking.
        expect(page.items[0]).toMatchObject({ kind: 'user', text: 'Survey the docs folder and say what is missing.', turnId: null });
        expect(page.items[1]).toMatchObject({ kind: 'thinking', text: 'The docs folder first.', streaming: false });
        expect(page.items[2]).toMatchObject({ kind: 'tool', name: 'Glob', state: 'done', output: 'docs/README.md\ndocs/DECISIONS.md' });
        expect(page.items[3]).toMatchObject({ kind: 'subagent', toolUseId: GRANDCHILD_CALL, status: 'done', result: 'There are 42 headings.' });
        expect(page.items.at(-1)).toMatchObject({ kind: 'assistant', streaming: false, turnId: null });
        expect(page.items.every((item) => item.turnId === null)).toBe(true);
        expect(noted).toEqual([{ toolUseId: CHILD_CALL, native: { agentId: 'a4c2e8f10b3d5a7e9' } }]);
    });

    test('a row a fork copied opens in the session of the chat it was forked from, one step per fork', async () => {
        const original = info('chat-1', 'claude', SESSION);
        const fork = { ...info('chat-fork', 'claude', 'fork-session'), forkOf: { chatId: 'chat-1', turnId: 'turn-1', at: 1 } };
        const forkOfFork = { ...info('chat-fork-2', 'claude', 'fork-session-2'), forkOf: { chatId: 'chat-fork', turnId: 'turn-1', at: 2 } };
        const stored = new Map([original, fork].map((entry) => [entry.chatId, entry]));
        chats.set('chat-fork-2', { ...claudeChat([row(CHILD_CALL, { status: 'done' })]), info: forkOfFork });
        const reader = new SubagentReader({
            chat: (chatId) => chats.get(chatId) ?? null,
            chatInfo: async (chatId) => stored.get(chatId) ?? null,
            claudeProjectsDir: projects,
            codexProcess: (chatInfo) => ({ command: ['codex', 'app-server'], cwd: chatInfo.cwd, env: {} }),
            notify: () => undefined,
            seams: watch
        });
        const page = await reader.read('chat-fork-2', CHILD_CALL);
        expect(page.items[0]).toMatchObject({ kind: 'user', text: 'Survey the docs folder and say what is missing.' });
    });

    test('a grandchild opens by the call that opened it, and is live while its row in the child says so', async () => {
        chats.set('chat-1', claudeChat([row(CHILD_CALL)]));
        const reader = makeReader();
        const child = await reader.read('chat-1', CHILD_CALL);
        expect(child.live).toBe(true);
        const grandchild = await reader.read('chat-1', GRANDCHILD_CALL);
        expect(grandchild.items.map((item) => (item.kind === 'user' || item.kind === 'assistant' ? item.text : item.kind))).toEqual([
            'Count the headings in docs/DECISIONS.md.',
            'There are 42 headings.'
        ]);
        expect(grandchild.live).toBe(false);
    });

    test('a subagent of more steps than a row keeps pages back to its first step, whatever process ran it', async () => {
        chats.set('chat-1', claudeChat([row(CHILD_CALL, { status: 'done' })]));
        let steps = '';
        for (let step = 1; step <= 250; step++) {
            steps += toolStep(step);
        }
        await appendFile(join(subagentsDir(), CHILD_FILE), steps);

        // A reader of its own stands in for a daemon that restarted: nothing is known but the files.
        const reader = makeReader();
        const collected: ChatItem[] = [];
        let cursor: string | undefined;
        do {
            const page = await reader.read('chat-1', CHILD_CALL, cursor, 100);
            expect(page.items.length).toBeLessThanOrEqual(100);
            collected.unshift(...page.items);
            cursor = page.history.cursor ?? undefined;
        } while (cursor !== undefined);

        const tools = collected.filter((item) => item.kind === 'tool');
        expect(tools).toHaveLength(251);
        expect(tools.at(-1)).toMatchObject({ input: { command: 'echo 250' }, output: '250', state: 'done' });
        expect(new Set(collected.map((item) => item.id)).size).toBe(collected.length);
        expect(await reader.readAll('chat-1', CHILD_CALL)).toEqual(collected);
    });

    test('a client holding it hears once per burst of lines, and one watch serves every transcript in the folder', async () => {
        chats.set('chat-1', claudeChat([row(CHILD_CALL)]));
        const reader = makeReader();
        await reader.read('chat-1', CHILD_CALL);
        await reader.read('chat-1', GRANDCHILD_CALL);
        reader.hold('client-a', 'chat-1', CHILD_CALL);
        reader.hold('client-b', 'chat-1', CHILD_CALL);
        reader.hold('client-a', 'chat-1', GRANDCHILD_CALL);
        const watcher = watch.on(subagentsDir());

        await appendFile(join(subagentsDir(), CHILD_FILE), toolStep(1));
        watcher.emit(CHILD_FILE);
        watcher.emit(CHILD_FILE);
        await watch.settle();
        expect(told).toEqual([
            { clientId: 'client-a', event: { chatId: 'chat-1', toolUseId: CHILD_CALL } },
            { clientId: 'client-b', event: { chatId: 'chat-1', toolUseId: CHILD_CALL } }
        ]);
        const grown = await reader.read('chat-1', CHILD_CALL);
        expect(grown.items.at(-1)).toMatchObject({ kind: 'tool', input: { command: 'echo 1' } });

        reader.releaseClient('client-a');
        expect(watcher.closed).toBe(false);
        reader.release('client-b', 'chat-1', CHILD_CALL);
        expect(watcher.closed).toBe(true);
        expect(reader.holdCount).toBe(0);
    });

    // The folder of a run as Claude Code 2.1.282 writes it: a transcript and a meta per agent, and nothing naming a call.
    test("a workflow's agent opens by its agent id from its run's folder, and is live while the run's report has it working", async () => {
        const run = join(subagentsDir(), 'workflows', 'wf_7486973f-3a9');
        await mkdir(run, { recursive: true });
        await writeFile(
            join(run, 'agent-a8a14782f2a71dcab.meta.json'),
            JSON.stringify({ agentType: 'workflow-subagent', description: 'write-file', workflowPhase: 'Write' })
        );
        await writeFile(join(run, 'agent-a8a14782f2a71dcab.jsonl'), toolStep(1));
        const agent = { index: 1, label: 'write-file', phaseIndex: 1, agentId: 'a8a14782f2a71dcab', startedAt: 0, durationMs: null, lastTool: null };
        const workflowRow = (status: 'running' | 'done'): ChatItem => ({
            id: '1:toolu_wf',
            kind: 'tool',
            createdAt: 0,
            turnId: 'turn-1',
            toolUseId: 'toolu_wf',
            name: 'Workflow',
            input: {},
            output: null,
            state: 'running',
            parentToolUseId: null,
            workflow: { name: 'write-and-read', phases: [{ index: 1, title: 'Write' }], agents: [{ ...agent, status }] }
        });
        const items = [workflowRow('running')];
        chats.set('chat-1', claudeChat(items));
        const reader = makeReader();
        const ref = workflowAgentRef('a8a14782f2a71dcab');

        const page = await reader.read('chat-1', ref);
        expect(page.items.map((item) => item.kind)).toEqual(['tool']);
        expect(page.live).toBe(true);
        items[0] = workflowRow('done');
        expect((await reader.read('chat-1', ref)).live).toBe(false);

        reader.hold('client-a', 'chat-1', ref);
        const watcher = watch.on(run);
        await appendFile(join(run, 'agent-a8a14782f2a71dcab.jsonl'), toolStep(2));
        watcher.emit('agent-a8a14782f2a71dcab.jsonl');
        await watch.settle();
        expect(told).toEqual([{ clientId: 'client-a', event: { chatId: 'chat-1', toolUseId: ref } }]);

        await expect(reader.read('chat-1', workflowAgentRef('../elsewhere'))).rejects.toMatchObject({ code: 'subagent-not-found' });
    });

    test('a transcript that was rewritten shorter expires the cursors into the old one', async () => {
        chats.set('chat-1', claudeChat([row(CHILD_CALL)]));
        const reader = makeReader();
        const first = await reader.read('chat-1', CHILD_CALL, undefined, 2);
        expect(first.history.cursor).not.toBeNull();
        await writeFile(join(subagentsDir(), CHILD_FILE), toolStep(1));
        await expect(reader.read('chat-1', CHILD_CALL, first.history.cursor!, 2)).rejects.toMatchObject({ code: 'history-expired' });
        expect((await reader.read('chat-1', CHILD_CALL)).items.map((item) => item.kind)).toEqual(['tool']);
    });

    test('a subagent the CLI wrote nothing for is refused, not failed', async () => {
        chats.set('chat-1', claudeChat([]));
        await expect(makeReader().read('chat-1', 'toolu_unknown')).rejects.toMatchObject({ code: 'subagent-not-found' });
        chats.set('chat-2', { ...claudeChat([]), info: info('chat-2', 'claude', null) });
        await expect(makeReader().read('chat-2', CHILD_CALL)).rejects.toMatchObject({ code: 'subagent-not-found' });
        await expect(makeReader().read('chat-3', CHILD_CALL)).rejects.toMatchObject({ code: 'chat-not-found' });
    });
});

describe('a Codex subagent', () => {
    // A thread of the shape `thread/items/list` answers, newest first with a cursor that counts from that end.
    const thread: Record<string, unknown>[] = [];
    const answer = (params: ThreadItemsParams): unknown => {
        const newestFirst = [...thread].reverse();
        const start = params.cursor ? Number(params.cursor) : 0;
        const page = newestFirst.slice(start, start + params.limit);
        return {
            data: page.map((item) => ({ item, turnId: 't' })),
            nextCursor: start + params.limit < newestFirst.length ? String(start + params.limit) : null
        };
    };

    const step = (index: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        type: 'commandExecution',
        id: `step-${index}`,
        command: `echo ${index}`,
        status: 'completed',
        aggregatedOutput: `${index}\n`,
        ...extra
    });

    beforeEach(() => {
        thread.length = 0;
        for (let index = 1; index <= 3; index++) {
            thread.push(step(index));
        }
    });

    const codexChat = (running: boolean, asked: ThreadItemsParams[] = []): SubagentChat => ({
        info: info('chat-x', 'codex', 'parent-thread'),
        running,
        items: () => [row('call-1', { native: { threadId: 'child-thread' } })],
        listThreadItems: (params) => {
            if (!running) {
                return null;
            }
            asked.push(params);
            return Promise.resolve(answer(params));
        },
        noteNative: () => undefined
    });

    test('reads through the running app-server, each item on its own, with a cursor of its own', async () => {
        thread.push({ type: 'reasoning', id: 'r-1', summary: ['First'], content: [] }, { type: 'reasoning', id: 'r-2', summary: ['Second'], content: [] });
        const asked: ThreadItemsParams[] = [];
        chats.set('chat-x', codexChat(true, asked));
        const reader = makeReader();
        const page = await reader.read('chat-x', 'call-1', undefined, 4);
        expect(asked[0]).toEqual({ threadId: 'child-thread', limit: 4, sortDirection: 'desc' });
        expect(page).toMatchObject({ source: 'codex-thread', live: true, history: { cursor: 'codex:4' } });
        expect(page.history.start).toBeUndefined();
        // Two reasoning items stay two thinking items, so the ids do not depend on where a page starts.
        expect(page.items.map((item) => item.kind)).toEqual(['tool', 'tool', 'thinking', 'thinking']);
        const older = await reader.read('chat-x', 'call-1', page.history.cursor!, 4);
        expect(older.items.map((item) => item.id)).toEqual(['0:step-1']);
        await expect(reader.read('chat-x', 'call-1', '1:5', 4)).rejects.toMatchObject({ code: 'history-expired' });
    });

    test('without a running process asks one started for the question, once for the same page within a few seconds', async () => {
        let now = 0;
        const asked: ThreadItemsParams[] = [];
        chats.set('chat-x', codexChat(false));
        const reader = makeReader(
            async (params) => {
                asked.push(params);
                return answer(params);
            },
            () => now
        );
        expect((await reader.read('chat-x', 'call-1')).live).toBe(false);
        await reader.read('chat-x', 'call-1');
        expect(asked).toHaveLength(1);
        now = 6000;
        await reader.read('chat-x', 'call-1');
        expect(asked).toHaveLength(2);
    });

    test('a held thread is polled while its parent runs, and a client hears only when its newest end moved', async () => {
        chats.set('chat-x', codexChat(true));
        const reader = makeReader();
        await reader.read('chat-x', 'call-1');
        reader.hold('client-a', 'chat-x', 'call-1');

        await watch.settle();
        expect(told).toEqual([]);

        thread.push(step(4));
        await watch.settle();
        await watch.settle();
        expect(told).toEqual([{ clientId: 'client-a', event: { chatId: 'chat-x', toolUseId: 'call-1' } }]);

        reader.releaseChat('chat-x');
        expect(reader.holdCount).toBe(0);
        expect(watch.pending).toBe(0);
    });
});
