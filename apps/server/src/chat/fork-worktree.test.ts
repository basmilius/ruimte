import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatInfo, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from '../git/test-repo.ts';
import { Worktrees } from '../git/worktrees.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { ChatStore } from './chat-store.ts';
import { claudeProjectSlug } from '@ruimte/agents/chat/claude-transcript';

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

let template: RepoTemplate;
let root: string;
let home: string;
let folder: string;
let projectId: string;
let store: ProjectStore;
let daemon: TestDaemon;

beforeAll(async () => {
    template = await repoTemplate('ruimte-fork-worktree', (dir) => initRepo(join(dir, 'repo'), { 'base.txt': 'base\n' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    folder = join(root, 'repo');
    home = join(root, 'home');
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), checkpoints: new Checkpoints(home), worktrees: new Worktrees(home) });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const turnsOf = (chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

/* Sends and waits until the turn settled with the tree of where it left the files. */
const say = async (chatId: string, text: string): Promise<void> => {
    const before = turnsOf(chatId).length;
    await daemon.chats.send(chatId, text);
    await daemon.until(() => {
        const turns = turnsOf(chatId);
        return daemon.chats.get(chatId)?.info.activeTurnId === null && turns.length === before + 1 && turns.at(-1)?.checkpointAfter !== undefined;
    });
};

/* Two turns that each write a file, with the transcript Claude Code would have written for them. */
const twoTurns = async (): Promise<ChatTurnItem[]> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await say('chat-lead', 'write: first.txt from turn one');
    await say('chat-lead', 'write: second.txt from turn two');
    const lead = daemon.chats.get('chat-lead')!;
    const sessionId = lead.info.agentSessionId!;
    const turns = turnsOf('chat-lead');
    const lines = turns.flatMap((turn, index) => [
        { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `turn ${index}` } },
        { type: 'assistant', uuid: turn.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'done' }] } }
    ]);
    const dir = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((entry) => JSON.stringify(entry)).join('\n'));
    return turns;
};

const fork = async (payload: Record<string, unknown>): Promise<{ nodeId: string; info: ChatInfo; worktree?: { path: string; branch: string } }> => {
    const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', ...payload });
    expect(answer).toMatchObject({ ok: true });
    return (answer as { result: { nodeId: string; info: ChatInfo; worktree?: { path: string; branch: string } } }).result;
};

test('a fork after turn 1 in a worktree holds the files after turn 1, with the index on HEAD and the difference unstaged', async () => {
    const turns = await twoTurns();
    expect(await daemon.request('chat.forkInfo', { chatId: 'chat-lead', turnId: turns[0]!.id })).toMatchObject({
        ok: true,
        result: { repository: true, branch: 'lexer-fork', filesAfterTurn: true, branches: ['main'] }
    });

    const { nodeId, info, worktree } = await fork({ turnId: turns[0]!.id, worktree: {}, filesAfterTurn: true });
    expect(worktree).toMatchObject({ branch: 'lexer-fork' });
    const path = worktree!.path;
    expect(info.cwd).toBe(path);
    expect(await readFile(join(path, 'first.txt'), 'utf8')).toBe('from turn one\n');
    expect(existsSync(join(path, 'second.txt'))).toBe(false);
    expect(await gitIn(path, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await gitIn(path, ['status', '--porcelain'])).toBe('?? .ruimte/\n?? first.txt\n');
    // The person's checkout keeps both files.
    expect(existsSync(join(folder, 'second.txt'))).toBe(true);

    const record = (await new ChatStore(home).read(nodeId))!;
    expect(record.items.at(-1)).toMatchObject({
        kind: 'note',
        text: 'Forked from Lexer after turn 1 of 2. The files start from the state after that turn, in worktree lexer-fork.'
    });
    expect(record.preambles[0]).toContain(`You work in a git worktree at ${path} on branch lexer-fork, with the files as they were after that turn.`);
    const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
    expect(canvas.nodes.find((node) => node.id === nodeId)).toMatchObject({ cwd: path });
    expect(existsSync(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(path), `${info.agentSessionId}.jsonl`))).toBe(true);
    const register = await new Worktrees(home).registerOf(folder).read();
    expect(register.get(path)).toMatchObject({ madeBy: 'fork', nodeId, projectId, branch: 'lexer-fork' });

    // The fork's own turn diff is its worktree alone.
    await daemon.chats.create({ chatId: nodeId });
    await say(nodeId, 'hello');
    await say(nodeId, 'write: third.txt from the fork');
    const diff = await daemon.chats.turnDiff(nodeId, turnsOf(nodeId).at(-1)!.id);
    expect(diff?.files.map((file) => file.path)).toEqual(['third.txt']);
    expect(existsSync(join(folder, 'third.txt'))).toBe(false);
});

test('without the files of the turn the worktree starts from HEAD', async () => {
    const turns = await twoTurns();
    const { worktree, nodeId } = await fork({ turnId: turns[0]!.id, worktree: { branch: 'lexer/head' } });
    expect(worktree?.branch).toBe('lexer/head');
    expect(existsSync(join(worktree!.path, 'first.txt'))).toBe(false);
    expect(await gitIn(worktree!.path, ['status', '--porcelain'])).toBe('');
    expect((await new ChatStore(home).read(nodeId))!.items.at(-1)).toMatchObject({
        text: expect.stringContaining('The files start from HEAD, in worktree lexer/head.')
    });
});

test('a tree git collected is refused before a worktree is made, and the dialog is told so first', async () => {
    const turns = await twoTurns();
    await gitIn(folder, ['prune', '--expire=now']);
    expect(await daemon.request('chat.forkInfo', { chatId: 'chat-lead', turnId: turns[0]!.id })).toMatchObject({ result: { filesAfterTurn: false } });
    expect(await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turns[0]!.id, worktree: {}, filesAfterTurn: true })).toMatchObject({
        ok: false,
        error: { code: 'checkpoint-missing' }
    });
    expect((await gitIn(folder, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm)).toHaveLength(1);
    expect(await gitIn(folder, ['branch', '--list', '--format=%(refname:short)'])).toBe('main\n');
    expect((await store.read(projectId)).views[0]).toMatchObject({ nodes: [expect.objectContaining({ id: 'chat-lead' })] });
});

test('a fork deleted before anyone wrote in it takes its record and transcript copy along and leaves its worktree', async () => {
    const turns = await twoTurns();
    const { nodeId, info, worktree } = await fork({ turnId: turns[1]!.id, worktree: {}, filesAfterTurn: true });
    const copy = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(worktree!.path), `${info.agentSessionId}.jsonl`);
    expect(existsSync(copy)).toBe(true);

    await store.mutate(projectId, (current) => ({
        content: {
            ...current,
            views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== nodeId), edges: [] } : view))
        },
        result: null
    }));
    await daemon.pruned();
    expect(existsSync(copy)).toBe(false);
    expect(await new ChatStore(home).read(nodeId)).toBeNull();
    expect(existsSync(worktree!.path)).toBe(true);
    expect(await new ChatStore(home).read('chat-lead')).not.toBeNull();
});
