import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from '@adecore/agents';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate, NO_WORKTREE_AGENTS } from '../git/test-repo.ts';
import { Worktrees } from '../git/worktrees.ts';
import { ManualClock } from '@adecore/agents/testing';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'chat-stranger', kind: 'chat', title: 'Stranger', x: 700, y: 0, w: 560, h: 640, provider: 'claude' }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

let template: RepoTemplate;
let root: string;
let folder: string;
let store: ProjectStore;
let daemon: TestDaemon;

beforeAll(async () => {
    template = await repoTemplate('ruimte-worktree-verb', async (dir) => {
        const repo = join(dir, 'repo');
        await initRepo(repo, { 'shared.txt': 'base\n' });
        // The commits a merge makes take the repository's identity; a worktree shares its config.
        await gitIn(repo, ['config', 'user.name', 'Ada']);
        await gitIn(repo, ['config', 'user.email', 'a@a']);
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    folder = join(root, 'repo');
    const home = join(root, 'home');
    store = new ProjectStore(home, projectLinks());
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
    daemon = await bootTestDaemon({
        home,
        store,
        clock: new ManualClock(),
        checkpoints: new Checkpoints(home),
        worktrees: new Worktrees(home, NO_WORKTREE_AGENTS)
    });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function firstTurn(chatId: string): ChatTurnItem | undefined {
    return daemon.chats
        .get(chatId)
        ?.thread.list()
        .find((item): item is ChatTurnItem => item.kind === 'turn');
}

/* A team of chat roles, each writing one file in a worktree of its own, with every first turn over. */
async function team(...roles: { title: string; writes: string }[]): Promise<string[]> {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    const asked = roles.map(({ title, writes }) => ({ title, prompt: `write: ${writes}`, provider: 'claude' }));
    const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--worktree', '--roles', JSON.stringify(asked)]);
    const nodes = lines.slice(1).map((line) => line.split('\t')[0]!);
    daemon.worker.start();
    await daemon.worker.settled();
    await daemon.until(() => nodes.every((node) => firstTurn(node)?.state === 'done'));
    return nodes;
}

const LEXER = { title: 'Lexer', writes: 'lexer.txt from the lexer' };
const PARSER = { title: 'Parser', writes: 'parser.txt from the parser' };

test('two roles that change the same file each work in a worktree of their own, and each turn diff holds only its own change', async () => {
    const [lexer, parser] = (await team(
        { title: 'Lexer', writes: 'shared.txt from the lexer' },
        { title: 'Parser', writes: 'shared.txt from the parser' }
    )) as [string, string];

    const lexerCwd = daemon.chats.get(lexer)!.info.cwd;
    const parserCwd = daemon.chats.get(parser)!.info.cwd;
    expect(lexerCwd).not.toBe(parserCwd);
    expect(await readFile(join(lexerCwd, 'shared.txt'), 'utf8')).toBe('from the lexer\n');
    expect(await readFile(join(parserCwd, 'shared.txt'), 'utf8')).toBe('from the parser\n');
    // The person's own checkout is left as it was.
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('base\n');
    expect((await gitIn(folder, ['branch', '--list', '--format=%(refname:short)'])).split('\n').filter(Boolean).sort()).toEqual(['lexer', 'main', 'parser']);

    const lexerDiff = await daemon.chats.turnDiff(lexer, firstTurn(lexer)!.id);
    const parserDiff = await daemon.chats.turnDiff(parser, firstTurn(parser)!.id);
    expect(lexerDiff?.files.map((file) => file.path)).toEqual(['shared.txt']);
    expect(parserDiff?.files.map((file) => file.path)).toEqual(['shared.txt']);
    expect(lexerDiff?.files[0]?.diff).toContain('+from the lexer');
    expect(lexerDiff?.files[0]?.diff).not.toContain('parser');
    expect(parserDiff?.files[0]?.diff).toContain('+from the parser');
    expect(parserDiff?.files[0]?.diff).not.toContain('lexer');
});

test('a worktree an agent verb makes is written down with the branch and commit the project was on, the project and the node', async () => {
    await gitIn(folder, ['checkout', '--quiet', '-b', 'feature']);
    await gitIn(folder, ['commit', '--quiet', '--allow-empty', '--message', 'on feature']);
    const featureHead = (await gitIn(folder, ['rev-parse', 'HEAD'])).trim();
    const projectId = store.index.locate('chat-lead')!.projectId;

    const lines = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--worktree', '--title', 'Lexer']);
    const nodeId = lines[0]!.split('\t')[0]!;

    const worktrees = new Worktrees(join(root, 'home'), NO_WORKTREE_AGENTS);
    const listed = await worktrees.list(folder);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ branch: 'lexer', from: { branch: 'feature', commit: featureHead }, projectId, nodeId });
    // A second daemon over the same home reads what the first wrote.
    const register = await worktrees.registerOf(folder).read();
    expect(register.get(listed[0]!.path)).toMatchObject({ madeBy: 'verb', branchMade: true });
});

test('a lead lists the worktrees of its team with their nodes and counts', async () => {
    const [lexer, parser] = (await team(LEXER, PARSER)) as [string, string];

    const listed = await runVerb(daemon, 'chat-lead', 'worktree', ['list']);
    const rows = listed.map((line) => line.split('\t'));
    expect(rows.map((row) => [row[0], row[2], row[3], row[4], row[5], row[6]])).toEqual([
        ['lexer', lexer, 'main', '0', '1', '0'],
        ['parser', parser, 'main', '0', '1', '0']
    ]);
});

test('a lead reads what a child wrote', async () => {
    await team(LEXER);

    expect(await runVerb(daemon, 'chat-lead', 'worktree', ['diff', 'lexer', '--stat'])).toEqual(['file\tlexer.txt\t1\t0']);
    const diff = await runVerb(daemon, 'chat-lead', 'worktree', ['diff', 'lexer', '--tail', '1']);
    expect(diff).toEqual(['+from the lexer']);
});

test('a lead merges the worktree of its child into main, and the worktree, its branch and the child stay', async () => {
    const [lexer] = await team(LEXER);

    const lines = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'lexer', '--squash']);

    expect(lines[0]).toBe('merged\tlexer\tmain\tsquash');
    expect(lines[2]).toBe('kept\tthe worktree and its branch stay until a person removes them');
    expect(await readFile(join(folder, 'lexer.txt'), 'utf8')).toBe('from the lexer\n');
    expect((await gitIn(folder, ['log', '-1', '--format=%s'])).trim()).toBe('Lexer: work of the agent');
    expect((await runVerb(daemon, 'chat-lead', 'worktree', ['list'])).map((line) => line.split('\t')[0])).toEqual(['lexer']);
    expect((await gitIn(folder, ['branch', '--list', 'lexer'])).trim()).not.toBe('');
    expect(daemon.chats.get(lexer!)?.info.running).toBe(true);
});

test('a node that is not an opener of the worktree gets not-yours, and nothing is merged', async () => {
    await team(LEXER);

    const refused = await runVerb(daemon, 'chat-stranger', 'worktree', ['merge', 'lexer']);

    expect(refused[0]?.startsWith('refused\tnot-yours\t')).toBe(true);
    expect(await fileExists(join(folder, 'lexer.txt'))).toBe(false);
});

test('a conflict is taken back and refused, leaving the target clean', async () => {
    const [parser] = await team({ title: 'Parser', writes: 'shared.txt from the parser' });
    // main moves on under the parser by a commit of its own, which costs fewer processes than a merge of another role.
    await writeFile(join(folder, 'shared.txt'), 'from the lexer\n');
    await gitIn(folder, ['commit', '--quiet', '--all', '--message', 'shared.txt on main']);

    const refused = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'parser']);

    expect(refused[0]).toStartWith('refused\tmerge-conflict\tMerging parser into main conflicts in 1 file: shared.txt.');
    expect((await gitIn(folder, ['status', '--porcelain', '--untracked-files=no'])).trim()).toBe('');
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('from the lexer\n');
    expect(await fileExists(daemon.chats.get(parser!)!.info.cwd)).toBe(true);
    expect((await gitIn(folder, ['branch', '--list', 'parser'])).trim()).not.toBe('');
});

test('a target checkout with uncommitted files of its own is refused', async () => {
    await team(LEXER);
    await writeFile(join(folder, 'shared.txt'), 'a person is working here\n');

    const refused = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'lexer']);

    expect(refused[0]?.startsWith('refused\ttarget-dirty\t')).toBe(true);
    expect(await fileExists(join(folder, 'lexer.txt'))).toBe(false);
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('a person is working here\n');
});
