import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, ChatItem, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { AgentLineageStore } from '../agents/lineage.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';
import { claudeProjectSlug } from './claude-transcript.ts';
import { inProcess } from './fake-cli.ts';
import { fakeCodex, fakeCodexForks } from './fake-codex.ts';
import { chatForkDeps, forkChat, itemsThrough, type ChatForkDeps } from './fork.ts';

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lexer', x: 0, y: 0, w: 560, h: 640, provider: 'claude', providerFixed: true }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

const turnsOf = (items: readonly ChatItem[]): ChatTurnItem[] => items.filter((item): item is ChatTurnItem => item.kind === 'turn');

const assistantTexts = (items: readonly ChatItem[]): string[] => items.flatMap((item) => (item.kind === 'assistant' ? [item.text] : []));

describe('forking a Claude chat', () => {
    let root: string;
    let home: string;
    let folder: string;
    let store: ProjectStore;
    let projectId: string;
    let daemon: TestDaemon;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-fork-'));
        home = join(root, 'home');
        folder = join(root, 'repo');
        await mkdir(folder, { recursive: true });
        store = new ProjectStore(home);
        const opened = await store.openProject({ folder });
        projectId = opened.summary.projectId;
        await store.save(projectId, opened.document.rev, content());
        store.release(projectId);
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock() });
        daemon.worker.start();
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    const say = async (chatId: string, text: string): Promise<void> => {
        const before = turnsOf(daemon.chats.get(chatId)?.thread.list() ?? []).length;
        await daemon.chats.send(chatId, text);
        await daemon.until(() => {
            const chat = daemon.chats.get(chatId);
            return chat !== undefined && chat.info.activeTurnId === null && turnsOf(chat.thread.list()).length === before + 1;
        });
    };

    /* Four turns, and the transcript Claude Code would have written for them, keyed on the uuids the turns ended on. */
    const fourTurns = async (): Promise<{ turns: ChatTurnItem[]; sessionId: string }> => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        for (const word of ['alpha', 'bravo', 'charlie', 'delta']) {
            await say('chat-lead', word);
        }
        const lead = daemon.chats.get('chat-lead')!;
        const sessionId = lead.info.agentSessionId!;
        const turns = turnsOf(lead.thread.list());
        const lines = turns.flatMap((turn, index) => [
            { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `word ${index}` } },
            { type: 'assistant', uuid: turn.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'echo' }] } },
            { type: 'last-prompt', sessionId, lastPrompt: `word ${index}` }
        ]);
        const dir = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((entry) => JSON.stringify(entry)).join('\n'));
        return { turns, sessionId };
    };

    test('a fork at turn 2 of 4 is a node beside the original with the items through turn 2, its own transcript and a note for its agent', async () => {
        const { turns } = await fourTurns();
        expect(turns.every((turn) => turn.native?.lastUuid !== undefined)).toBe(true);
        const leadItems = daemon.chats.get('chat-lead')!.thread.list();

        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[1]!.id });
        expect(answer).toMatchObject({ ok: true, result: { viewId: 'main', edgeId: expect.any(String) } });
        const { nodeId, info } = (answer as { result: { nodeId: string; info: ChatInfo } }).result;

        const record = (await new ChatStore(home).read(nodeId))!;
        expect(record.info).toMatchObject({ chatId: nodeId, provider: 'claude', forkOf: { chatId: 'chat-lead', turnId: turns[1]!.id }, activeTurnId: null });
        expect(record.info.agentSessionId).toBe(info.agentSessionId);
        const expected = itemsThrough(leadItems, turns[1]!.id);
        expect(record.items.slice(0, -1).map((item) => item.id)).toEqual(expected.map((item) => item.id));
        expect(turnsOf(record.items).map((turn) => turn.id)).toEqual([turns[0]!.id, turns[1]!.id]);
        expect(record.items.at(-1)).toMatchObject({
            kind: 'note',
            text: 'Forked from Lexer after turn 2 of 4. The files stay as they are now, which may be newer than that turn. The folder is in no git repository, so the fork has no worktree of its own.'
        });
        expect(record.preambles).toEqual([expect.stringContaining('forked from node chat-lead ("Lexer") after turn 2 of 4')]);

        const transcript = await readFile(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder), `${info.agentSessionId}.jsonl`), 'utf8');
        const lines = transcript
            .trim()
            .split('\n')
            .map((raw) => JSON.parse(raw) as { uuid?: string; sessionId: string });
        expect(lines.map((entry) => entry.uuid ?? '-')).toEqual(['prompt-0', turns[0]!.native!.lastUuid!, '-', 'prompt-1', turns[1]!.native!.lastUuid!, '-']);
        expect(lines.every((entry) => entry.sessionId === info.agentSessionId)).toBe(true);

        const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
        expect(canvas.nodes.find((node) => node.id === nodeId)).toMatchObject({
            kind: 'chat',
            provider: 'claude',
            providerFixed: true,
            title: 'Lexer (fork)',
            x: 600
        });
        expect(canvas.edges).toEqual([expect.objectContaining({ from: 'chat-lead', to: nodeId })]);
        expect([daemon.lineage.madeBy(nodeId), daemon.lineage.projectOf(nodeId)]).toEqual([null, projectId]);
    });

    test('a chat view forks into a chat view listed right after it, with the items through the turn and its original to read', async () => {
        const { turns } = await fourTurns();
        const leadItems = daemon.chats.get('chat-lead')!.thread.list();
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: [
                    { ...(current.views[0] as ProjectCanvasView), nodes: [] },
                    { kind: 'chat', id: 'chat-lead', name: 'Lexer', node: { provider: 'claude', providerFixed: true } },
                    { kind: 'drawing', id: 'sketch', name: 'Sketch' }
                ]
            },
            result: null
        }));

        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[1]!.id });
        expect(answer).toMatchObject({ ok: true, result: { edgeId: null } });
        const { nodeId, viewId } = (answer as { result: { nodeId: string; viewId: string } }).result;
        expect(viewId).toBe(nodeId);

        const views = (await store.read(projectId)).views;
        expect(views.map((view) => view.id)).toEqual(['main', 'chat-lead', nodeId, 'sketch']);
        expect(views[2]).toMatchObject({ kind: 'chat', name: 'Lexer (fork)', node: { provider: 'claude', providerFixed: true } });
        expect((views[0] as ProjectCanvasView).nodes).toEqual([]);

        const record = (await new ChatStore(home).read(nodeId))!;
        expect(record.info.forkOf).toMatchObject({ chatId: 'chat-lead', turnId: turns[1]!.id });
        expect(record.items.slice(0, -1).map((item) => item.id)).toEqual(itemsThrough(leadItems, turns[1]!.id).map((item) => item.id));
        expect(record.preambles).toEqual([expect.stringContaining('forked from view chat-lead ("Lexer") after turn 2 of 4')]);
        expect(daemon.lineage.forkedFrom(nodeId)).toBe('chat-lead');
    });

    test('the first message in the fork carries its note and the next one does not', async () => {
        const { turns } = await fourTurns();
        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[3]!.id });
        const { nodeId } = (answer as { result: { nodeId: string } }).result;
        await daemon.chats.create({ chatId: nodeId });
        await say(nodeId, 'go on');
        await say(nodeId, 'and then');
        const replies = assistantTexts(daemon.chats.get(nodeId)!.thread.list()).slice(-2);
        expect(replies[0]).toContain('forked from node chat-lead ("Lexer") after its last turn (turn 4)');
        expect(replies[0]).toEndWith('go on');
        expect(replies[1]).not.toContain('forked from');
        expect(daemon.chats.get(nodeId)!.preambles).toEqual([]);
        daemon.chats.persistAllSync();
        expect((await new ChatStore(home).read(nodeId))!.preambles).toEqual([]);
        // The fork resumed its own session, never the original's.
        expect(daemon.claude.started.at(-1)!.argv).toContain(daemon.chats.get(nodeId)!.info.agentSessionId!);
    });

    test('a fork deleted unused takes its record and transcript copy along, loaded or not, and one written in keeps its record', async () => {
        const { turns } = await fourTurns();
        const forkAt = async (turnId: string): Promise<{ nodeId: string; copy: string }> => {
            const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId });
            const { nodeId, info } = (answer as { result: { nodeId: string; info: ChatInfo } }).result;
            return { nodeId, copy: join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder), `${info.agentSessionId}.jsonl`) };
        };
        const unopened = await forkAt(turns[1]!.id);
        const loaded = await forkAt(turns[2]!.id);
        const spoken = await forkAt(turns[3]!.id);
        await daemon.chats.create({ chatId: loaded.nodeId });
        await daemon.chats.create({ chatId: spoken.nodeId });
        await say(spoken.nodeId, 'go on');

        const gone = new Set([unopened.nodeId, loaded.nodeId, spoken.nodeId]);
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => !gone.has(node.id)), edges: [] } : view
                )
            },
            result: null
        }));
        // What a client does for a node that left, which only reaches a chat this daemon has loaded.
        await daemon.request('chat.kill', { chatId: loaded.nodeId });
        await daemon.pruned();
        const chats = new ChatStore(home);
        expect([await chats.read(unopened.nodeId), await chats.read(loaded.nodeId)]).toEqual([null, null]);
        expect([existsSync(unopened.copy), existsSync(loaded.copy)]).toEqual([false, false]);
        expect(await chats.read(spoken.nodeId)).not.toBeNull();
        expect(existsSync(spoken.copy)).toBe(true);
    });

    test('a running turn is refused, and stopping or deleting the original leaves the fork alone', async () => {
        const { turns } = await fourTurns();
        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[0]!.id });
        const { nodeId } = (answer as { result: { nodeId: string } }).result;

        await daemon.chats.send('chat-lead', 'slow');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId !== null);
        const running = daemon.chats.get('chat-lead')!.info.activeTurnId!;
        expect(await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: running })).toMatchObject({ ok: false, error: { code: 'turn-running' } });
        expect(await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[3]!.id })).toMatchObject({ ok: false, error: { code: 'chat-busy' } });

        expect(await daemon.request('agent.children', { nodeId: 'chat-lead' })).toMatchObject({ result: { nodeIds: [] } });
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== 'chat-lead') } : view))
            },
            result: null
        }));
        expect(await daemon.request('chat.kill', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        await daemon.worker.settled();
        expect(daemon.lineage.endedAt(nodeId)).toBeNull();
        expect(daemon.outbox.list()).toEqual([]);
        expect(await new ChatStore(home).read(nodeId)).not.toBeNull();
    });
});

describe('forkChat', () => {
    const info = (provider: ChatInfo['provider']): ChatInfo => ({
        chatId: 'chat-lead',
        provider,
        cwd: '/work',
        agentSessionId: 'session-1',
        model: null,
        selection: { model: 'm', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        queue: [],
        usage: { contextTokens: 900, contextWindow: 1000, costUsd: 3, turns: 3 },
        suggestedTitle: 'Lexer',
        createdAt: 0
    });

    const turn = (id: string, native?: ChatTurnItem['native']): ChatItem => ({
        id,
        kind: 'turn',
        createdAt: 0,
        turnId: id,
        state: 'done',
        endedAt: 1,
        costUsd: 0,
        ...(native ? { native } : {})
    });

    const user = (id: string, turnId: string): ChatItem => ({ id, kind: 'user', createdAt: 0, turnId, text: id });

    /* Deps around an in-memory canvas, which record what the fork asked of each CLI. */
    const stub = (source: { info: ChatInfo; items: ChatItem[] }) => {
        let document = content();
        const asked: { claude: unknown[]; codex: unknown[]; written: Array<{ info: ChatInfo; items: ChatItem[]; preambles: string[] }> } = {
            claude: [],
            codex: [],
            written: []
        };
        const deps: ChatForkDeps = {
            source: async () => source,
            installed: async () => ['claude', 'codex'],
            locate: () => ({ projectId: 'p1', folder: '/work', canvasId: 'main' }),
            titleFor: () => 'Lexer',
            read: async () => document,
            mutate: async (_projectId, apply) => {
                const mutation = await apply(document);
                document = mutation.content ?? document;
                await mutation.landed?.();
                return mutation.result;
            },
            depthOf: () => 0,
            recordFork: async () => undefined,
            forkClaude: async (input) => {
                asked.claude.push(input.at);
                return { undo: async () => undefined };
            },
            forkCodex: async (input) => {
                asked.codex.push(input.at);
                return 'thread-2';
            },
            branchesOf: async () => null,
            addWorktree: async () => Promise.reject(new Error('no worktrees here')),
            treeExists: async () => false,
            takeTree: async () => null,
            restoreTree: async () => undefined,
            writeRecord: async (_chatId, written, items, preambles) => {
                asked.written.push({ info: written, items, preambles });
            },
            deleteRecord: async () => undefined,
            newSessionId: () => 'session-2',
            now: () => 5
        };
        return { deps, asked };
    };

    test('a turn older than the names the CLI gives is cut by counting, and both notes say so', async () => {
        const items = [turn('turn-1'), user('user-1', 'turn-1'), turn('turn-2'), user('user-2', 'turn-2'), turn('turn-3', { lastUuid: 'u-3' })];
        const { deps, asked } = stub({ info: info('claude'), items });
        const result = await forkChat(deps, { chatId: 'chat-lead', turnId: 'turn-2' });
        expect(asked.claude).toEqual([{ turns: 2 }]);
        const written = asked.written[0]!;
        expect(written.items.at(-1)).toMatchObject({ kind: 'note', text: expect.stringContaining('counting turns') });
        expect(written.preambles[0]).toContain('if the last message you remember does not match, say so');
        // A fork starts with no queue, no name of the CLI's and nothing spent, but keeps the mode and the turns it has.
        expect(result.info).toMatchObject({ agentSessionId: 'session-2', runtimeMode: 'supervised', usage: { contextTokens: 0, costUsd: 0, turns: 2 } });
        expect(result.info.queue).toBeUndefined();
        expect(result.info.suggestedTitle).toBeUndefined();
    });

    test('Codex is asked for the turn it named, all of it for a last turn without a name, and a count otherwise', async () => {
        const items = [turn('turn-1'), turn('turn-2', { turnId: 'codex-2' }), turn('turn-3')];
        const { deps, asked } = stub({ info: info('codex'), items });
        for (const turnId of ['turn-2', 'turn-3', 'turn-1']) {
            await forkChat(deps, { chatId: 'chat-lead', turnId });
        }
        expect(asked.codex).toEqual([{ turnId: 'codex-2' }, null, { turns: 1 }]);
    });

    test('a node asked to fork into a view gets a view after its canvas, and a chat view still takes a named canvas', async () => {
        const { deps, asked } = stub({ info: info('claude'), items: [turn('turn-1', { lastUuid: 'u-1' })] });
        let document: ProjectContent = { ...content(), views: [...content().views, { kind: 'drawing', id: 'sketch', name: 'Sketch' }] };
        const onDocument: ChatForkDeps = {
            ...deps,
            read: async () => document,
            mutate: async (_projectId, apply) => {
                const mutation = await apply(document);
                document = mutation.content ?? document;
                await mutation.landed?.();
                return mutation.result;
            }
        };
        const asView = await forkChat(onDocument, { chatId: 'chat-lead', turnId: 'turn-1', asView: true });
        expect(asView).toMatchObject({ viewId: asView.nodeId, edgeId: null });
        expect(document.views.map((view) => view.id)).toEqual(['main', asView.nodeId, 'sketch']);
        expect((document.views[0] as ProjectCanvasView).nodes).toHaveLength(1);
        expect(asked.written[0]!.preambles[0]).toContain('forked from node chat-lead');

        const onCanvas = await forkChat(
            { ...onDocument, locate: (id) => ({ projectId: 'p1', folder: '/work', canvasId: id === 'chat-lead' ? null : 'main' }) },
            { chatId: 'chat-lead', turnId: 'turn-1', viewId: 'main' }
        );
        expect(onCanvas).toMatchObject({ viewId: 'main', edgeId: null });
        expect((document.views[0] as ProjectCanvasView).nodes.map((node) => node.id)).toContain(onCanvas.nodeId);
    });

    test('a record that cannot be written takes back the worktree and the transcript copy made for the fork', async () => {
        const { deps } = stub({ info: info('claude'), items: [turn('turn-1', { lastUuid: 'u-1' }), turn('turn-2', { lastUuid: 'u-2' })] });
        const undone: string[] = [];
        const refused = forkChat(
            {
                ...deps,
                branchesOf: async () => ['main'],
                addWorktree: async ({ branch }) => ({
                    worktree: { path: `/worktrees/${branch}`, branch },
                    cwd: `/worktrees/${branch}`,
                    undo: async () => {
                        undone.push('worktree');
                    }
                }),
                forkClaude: async () => ({
                    undo: async () => {
                        undone.push('transcript');
                    }
                }),
                writeRecord: () => Promise.reject(new Error('disk full'))
            },
            { chatId: 'chat-lead', turnId: 'turn-1', worktree: {} }
        );
        await expect(refused).rejects.toThrow('disk full');
        expect(undone).toEqual(['transcript', 'worktree']);
    });

    test('a worktree is refused outside a repository and for a branch that exists, before anything is made', async () => {
        const { deps, asked } = stub({ info: info('claude'), items: [turn('turn-1', { lastUuid: 'u-1' })] });
        await expect(forkChat(deps, { chatId: 'chat-lead', turnId: 'turn-1', worktree: {} })).rejects.toMatchObject({ code: 'not-a-repository' });
        await expect(
            forkChat({ ...deps, branchesOf: async () => ['main', 'taken'] }, { chatId: 'chat-lead', turnId: 'turn-1', worktree: { branch: 'taken' } })
        ).rejects.toMatchObject({ code: 'branch-exists' });
        expect([asked.claude, asked.written]).toEqual([[], []]);
    });

    test('a refused CLI step writes nothing', async () => {
        const { deps, asked } = stub({ info: info('claude'), items: [turn('turn-1', { lastUuid: 'u-1' })] });
        await expect(
            forkChat({ ...deps, forkClaude: () => Promise.reject(new Error('disk full')) }, { chatId: 'chat-lead', turnId: 'turn-1' })
        ).rejects.toMatchObject({ code: 'fork-failed', message: 'disk full' });
        expect(asked.written).toHaveLength(0);
    });
});

describe('forking a Codex chat', () => {
    let home: string;
    let manager: ChatManager;

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-fork-codex-'));
        const attachments = new AttachmentStore(home);
        manager = new ChatManager({
            providers: new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) }),
            store: new ChatStore(home, attachments),
            attachments,
            spawn: inProcess(fakeCodex).spawn,
            env: { PATH: process.env.PATH, HOME: home }
        });
    });

    afterEach(async () => {
        await manager.shutdown();
        for (const info of manager.list()) {
            manager.get(info.chatId)?.dispose();
        }
        await rm(home, { recursive: true, force: true });
    });

    test('thread/fork is asked with the turn id Codex gave turn 2, beside the original that keeps its own process', async () => {
        await manager.create({ chatId: 'chat-lead', provider: 'codex', cwd: home });
        for (const word of ['alpha', 'bravo', 'charlie', 'delta']) {
            const before = turnsOf(manager.get('chat-lead')!.thread.list()).length;
            await manager.send('chat-lead', word);
            await new Promise<void>((resolve) => {
                const stop = manager.observe(() => {
                    const lead = manager.get('chat-lead')!;
                    if (lead.info.activeTurnId === null && turnsOf(lead.thread.list()).length === before + 1) {
                        stop();
                        resolve();
                    }
                });
            });
        }
        const lead = manager.get('chat-lead')!;
        const turns = turnsOf(lead.thread.list());
        let document: ProjectContent = {
            ...content(),
            views: [
                {
                    ...(content().views[0] as ProjectCanvasView),
                    nodes: [{ ...(content().views[0] as ProjectCanvasView).nodes[0]!, provider: 'codex' as const }]
                }
            ]
        };
        const host: Pick<CanvasHost, 'installedAgents' | 'locate' | 'read' | 'mutate'> = {
            installedAgents: async () => ['codex'],
            locate: () => ({ projectId: 'p1', folder: home, canvasId: 'main' }),
            read: async () => document,
            mutate: async (_projectId, apply) => {
                const mutation = await apply(document);
                document = mutation.content ?? document;
                await mutation.landed?.();
                return mutation.result;
            }
        };
        const deps = chatForkDeps({ chats: manager, host, titleFor: () => 'Lexer', lineage: new AgentLineageStore(home) });

        const result = await forkChat(deps, { chatId: 'chat-lead', turnId: turns[1]!.id });
        expect(fakeCodexForks.at(-1)).toMatchObject({
            threadId: lead.info.agentSessionId,
            lastTurnId: turns[1]!.native!.turnId,
            cwd: home,
            excludeTurns: true
        });
        expect(result.info.agentSessionId).toStartWith('fork-');
        expect(lead.running).toBe(true);
        expect(turnsOf((await new ChatStore(home).read(result.nodeId))!.items)).toHaveLength(2);
    });
});
