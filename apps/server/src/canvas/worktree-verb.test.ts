import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from '../git/test-repo.ts';
import { Worktrees } from '../git/worktrees.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';

const content = (): ProjectContent => ({
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
});

let template: RepoTemplate;
let root: string;
let folder: string;
let store: ProjectStore;
let daemon: TestDaemon;

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

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
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
    daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), checkpoints: new Checkpoints(home), worktrees: new Worktrees(home) });
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const firstTurn = (chatId: string): ChatTurnItem | undefined =>
    daemon.chats
        .get(chatId)
        ?.thread.list()
        .find((item): item is ChatTurnItem => item.kind === 'turn');

/* A team of two chat roles, each writing one file in a worktree of its own, with both first turns over. */
const team = async (lexerWrites: string, parserWrites: string): Promise<{ lexer: string; parser: string }> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    const roles = [
        { title: 'Lexer', prompt: `write: ${lexerWrites}`, provider: 'claude', chat: true },
        { title: 'Parser', prompt: `write: ${parserWrites}`, provider: 'claude', chat: true }
    ];
    const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--worktree', '--roles', JSON.stringify(roles)]);
    const [lexer, parser] = lines.slice(1).map((line) => line.split('\t')[0]!);
    daemon.worker.start();
    await daemon.worker.settled();
    await daemon.until(() => firstTurn(lexer!)?.state === 'done' && firstTurn(parser!)?.state === 'done');
    return { lexer: lexer!, parser: parser! };
};

test('a lead lists the worktrees of its team with their nodes and counts, and reads what a child wrote', async () => {
    const { lexer, parser } = await team('lexer.txt from the lexer', 'parser.txt from the parser');

    const listed = await runVerb(daemon, 'chat-lead', 'worktree', ['list']);
    const rows = listed.map((line) => line.split('\t'));
    expect(rows.map((row) => [row[0], row[2], row[3], row[4], row[5], row[6]])).toEqual([
        ['lexer', lexer, 'main', '0', '1', '0'],
        ['parser', parser, 'main', '0', '1', '0']
    ]);

    expect(await runVerb(daemon, 'chat-lead', 'worktree', ['diff', 'lexer', '--stat'])).toEqual(['file\tlexer.txt\t1\t0']);
    const diff = await runVerb(daemon, 'chat-lead', 'worktree', ['diff', 'lexer', '--tail', '1']);
    expect(diff).toEqual(['+from the lexer']);
});

test('a lead merges the worktree of its child into main, and the worktree, its branch and the child stay', async () => {
    const { lexer } = await team('lexer.txt from the lexer', 'parser.txt from the parser');

    const lines = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'lexer', '--squash']);

    expect(lines[0]).toBe('merged\tlexer\tmain\tsquash');
    expect(lines[2]).toBe('kept\tthe worktree and its branch stay until a person removes them');
    expect(await readFile(join(folder, 'lexer.txt'), 'utf8')).toBe('from the lexer\n');
    expect((await gitIn(folder, ['log', '-1', '--format=%s'])).trim()).toBe('Lexer: work of the agent');
    expect((await runVerb(daemon, 'chat-lead', 'worktree', ['list'])).map((line) => line.split('\t')[0])).toEqual(['lexer', 'parser']);
    expect((await gitIn(folder, ['branch', '--list', 'lexer'])).trim()).not.toBe('');
    expect(daemon.chats.get(lexer)?.info.running).toBe(true);
});

test('a node that is not an opener of the worktree gets not-yours, and nothing is merged', async () => {
    await team('lexer.txt from the lexer', 'parser.txt from the parser');

    const refused = await runVerb(daemon, 'chat-stranger', 'worktree', ['merge', 'lexer']);

    expect(refused[0]?.startsWith('refused\tnot-yours\t')).toBe(true);
    expect(await exists(join(folder, 'lexer.txt'))).toBe(false);
});

test('a conflict is taken back and refused, leaving the target clean', async () => {
    await team('shared.txt from the lexer', 'shared.txt from the parser');
    expect((await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'lexer']))[0]).toBe('merged\tlexer\tmain\tmerge');

    const refused = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'parser']);

    expect(refused[0]).toStartWith('refused\tmerge-conflict\tMerging parser into main conflicts in 1 file: shared.txt.');
    expect((await gitIn(folder, ['status', '--porcelain', '--untracked-files=no'])).trim()).toBe('');
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('from the lexer\n');
    expect((await runVerb(daemon, 'chat-lead', 'worktree', ['list'])).map((line) => line.split('\t')[0])).toEqual(['lexer', 'parser']);
});

test('a target checkout with uncommitted files of its own is refused', async () => {
    await team('lexer.txt from the lexer', 'parser.txt from the parser');
    await writeFile(join(folder, 'shared.txt'), 'a person is working here\n');

    const refused = await runVerb(daemon, 'chat-lead', 'worktree', ['merge', 'lexer']);

    expect(refused[0]?.startsWith('refused\ttarget-dirty\t')).toBe(true);
    expect(await exists(join(folder, 'lexer.txt'))).toBe(false);
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('a person is working here\n');
});
