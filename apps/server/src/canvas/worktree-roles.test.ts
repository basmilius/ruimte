import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
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
            nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
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

beforeAll(async () => {
    template = await repoTemplate('ruimte-worktree-roles', (dir) => initRepo(join(dir, 'repo'), { 'shared.txt': 'base\n' }));
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

test('two roles that change the same file each work in a worktree of their own, and each turn diff holds only its own change', async () => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    const roles = [
        { title: 'Lexer', prompt: 'write: shared.txt from the lexer', provider: 'claude', chat: true },
        { title: 'Parser', prompt: 'write: shared.txt from the parser', provider: 'claude', chat: true }
    ];
    const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--worktree', '--roles', JSON.stringify(roles)]);
    const [lexer, parser] = lines.slice(1).map((line) => line.split('\t')[0]!);
    daemon.worker.start();
    await daemon.worker.settled();
    await daemon.until(() => firstTurn(lexer!)?.state === 'done' && firstTurn(parser!)?.state === 'done');

    const lexerCwd = daemon.chats.get(lexer!)!.info.cwd;
    const parserCwd = daemon.chats.get(parser!)!.info.cwd;
    expect(lexerCwd).not.toBe(parserCwd);
    expect(await readFile(join(lexerCwd, 'shared.txt'), 'utf8')).toBe('from the lexer\n');
    expect(await readFile(join(parserCwd, 'shared.txt'), 'utf8')).toBe('from the parser\n');
    // The person's own checkout is left as it was.
    expect(await readFile(join(folder, 'shared.txt'), 'utf8')).toBe('base\n');
    expect((await gitIn(folder, ['branch', '--list', '--format=%(refname:short)'])).split('\n').filter(Boolean).sort()).toEqual(['lexer', 'main', 'parser']);

    const lexerDiff = await daemon.chats.turnDiff(lexer!, firstTurn(lexer!)!.id);
    const parserDiff = await daemon.chats.turnDiff(parser!, firstTurn(parser!)!.id);
    expect(lexerDiff?.files.map((file) => file.path)).toEqual(['shared.txt']);
    expect(parserDiff?.files.map((file) => file.path)).toEqual(['shared.txt']);
    expect(lexerDiff?.files[0]?.diff).toContain('+from the lexer');
    expect(lexerDiff?.files[0]?.diff).not.toContain('parser');
    expect(parserDiff?.files[0]?.diff).toContain('+from the parser');
    expect(parserDiff?.files[0]?.diff).not.toContain('lexer');
});
