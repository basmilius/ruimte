import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@adecore/agents/events';
import type { ChatToolItem, ChatTurnItem, ProvenanceRun } from '@ruimte/contracts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, repoTemplate, type RepoTemplate } from '../git/test-repo.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { ProvenanceService, type ProvenanceChat } from './provenance-service.ts';

const SCORE = [
    'export function scoreCandidate(c: Candidate) {',
    '    return c.hits;',
    '}',
    '',
    'export function rank(list: Candidate[]) {',
    '    return list;',
    '}',
    ''
].join('\n');
const DAY_MS = 24 * 60 * 60 * 1000;

let template: RepoTemplate;
const cleanups: string[] = [];

beforeAll(async () => {
    template = await repoTemplate('provenance', async (root) => {
        await gitIn(root, ['init', '--quiet', '--initial-branch=main']);
        await writeFile(join(root, 'score.ts'), SCORE);
        await gitIn(root, ['add', '.']);
        await gitIn(root, ['commit', '--quiet', '--message', 'init']);
    });
});

afterAll(async () => {
    await template.dispose();
});

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Setup {
    repo: string;
    service: ProvenanceService;
    heard: SessionEvent[];
    clock: { now: number };
    /* Starts a turn the way the chat does: its tree is taken before the agent writes. */
    startTurn(turnId: string, prompt?: string): Promise<void>;
    tool(turnId: string, name: string, input: Record<string, unknown>, extra?: Partial<ChatToolItem>): void;
    endTurn(turnId: string, settled?: boolean): Promise<void>;
    write(name: string, text: string): Promise<void>;
}

async function setup(options: { project?: boolean; git?: boolean } = {}): Promise<Setup> {
    const repo = options.git === false ? await mkdtemp(join(tmpdir(), 'provenance-plain-')) : await template.copy();
    if (options.git === false) {
        await writeFile(join(repo, 'score.ts'), SCORE);
    }
    const home = await mkdtemp(join(tmpdir(), 'provenance-home-'));
    cleanups.push(repo, home);
    const checkpoints = new Checkpoints(home);
    const trees = new Map<string, string>();
    const prompts = new Map<string, string>();
    const turns: string[] = [];
    const clock = { now: 1_800_000_000_000 };
    const chat: ProvenanceChat = {
        provider: 'claude',
        cwd: repo,
        checkpointOf: (turnId) => trees.get(turnId),
        turnNumberOf: (turnId) => turns.indexOf(turnId) + 1 || null,
        promptOf: (turnId) => prompts.get(turnId) ?? null
    };
    const service = new ProvenanceService({
        home,
        locate: () => (options.project === false ? null : { projectId: 'p1', folder: repo }),
        folderOf: (projectId) => (projectId === 'p1' ? repo : null),
        holders: () => ['client-1'],
        chat: () => chat,
        now: () => clock.now
    });
    const heard: SessionEvent[] = [];
    service.subscribe('client-1', (event) => heard.push(event));
    const send = (item: ChatToolItem | ChatTurnItem): void =>
        service.consume({ event: 'chat.event', payload: { chatId: 'chat-a', event: { type: 'item', item } } } as AgentEvent);
    let toolIds = 0;
    return {
        repo,
        service,
        heard,
        clock,
        async startTurn(turnId, prompt = 'Add rankCandidates') {
            turns.push(turnId);
            prompts.set(turnId, prompt);
            const tree = await checkpoints.take(repo);
            if (tree !== null) {
                trees.set(turnId, tree);
            }
        },
        tool(turnId, name, input, extra = {}) {
            send({
                id: `tool-${toolIds}`,
                createdAt: 1,
                turnId,
                kind: 'tool',
                toolUseId: `tool-${toolIds++}`,
                name,
                input,
                output: null,
                state: 'done',
                parentToolUseId: null,
                ...extra
            });
        },
        async endTurn(turnId, settled = true) {
            const tree = trees.get(turnId);
            const item: ChatTurnItem = {
                id: turnId,
                createdAt: 1,
                turnId,
                kind: 'turn',
                state: 'done',
                endedAt: 2,
                costUsd: 0,
                ...(tree === undefined ? {} : { checkpoint: tree })
            };
            send(item);
            if (settled && tree !== undefined) {
                const answer = await checkpoints.settle(repo, tree);
                send({ ...item, checkpointDiff: answer!.diff, checkpointAfter: answer!.after });
            }
        },
        write: (name, text) => writeFile(join(repo, name), text)
    };
}

const spans = (runs: readonly ProvenanceRun[]): Array<[number, number]> => runs.map((run) => [run.start, run.end]);

describe('the recorder', () => {
    test('a Claude Edit marks the lines it wrote, with what it replaced, the prompt and the turn', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return c.hits;', '    const hits = c.hits;\n    return hits * 2;'));
        t.tool('turn-1', 'Edit', {
            file_path: join(t.repo, 'score.ts'),
            old_string: '    return c.hits;',
            new_string: '    const hits = c.hits;\n    return hits * 2;'
        });
        await t.service.idle();

        const read = await t.service.read('p1', join(t.repo, 'score.ts'));
        expect(spans(read.runs)).toEqual([[2, 3]]);
        expect(read.runs[0]).toMatchObject({
            chatId: 'chat-a',
            turnId: 'turn-1',
            turn: 1,
            provider: 'claude',
            promptExcerpt: 'Add rankCandidates',
            review: 'pending',
            via: 'tool',
            before: ['    return c.hits;']
        });
        expect(read.lines).toBe(8);
        expect(t.heard.map((event) => event.event)).toEqual(['provenance.changed']);
        expect(t.heard[0]!.payload).toMatchObject({ projectId: 'p1', chatId: 'chat-a', turnId: 'turn-1', live: true });
    });

    test('a Write over an existing file marks only the lines that changed', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        const next = SCORE.replace('c.hits', 'c.hits + 1').replace('return list;', 'return list.slice();');
        await t.write('score.ts', next);
        t.tool('turn-1', 'Write', { file_path: join(t.repo, 'score.ts'), content: next });
        await t.service.idle();

        expect(spans((await t.service.read('p1', join(t.repo, 'score.ts'))).runs)).toEqual([
            [2, 2],
            [6, 6]
        ]);
    });

    test('a Write that creates a file marks all of it', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('new.ts', 'one\ntwo\nthree\n');
        t.tool('turn-1', 'Write', { file_path: join(t.repo, 'new.ts'), content: 'one\ntwo\nthree\n' });
        await t.service.idle();

        const runs = (await t.service.read('p1', join(t.repo, 'new.ts'))).runs;
        expect(spans(runs)).toEqual([[1, 3]]);
        expect(runs[0]!.before).toBeUndefined();
    });

    test('a Codex patch is found by the lines of its unified diff', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return list;', '    return list.sort();'));
        const diff = '@@ -5,3 +5,3 @@\n export function rank(list: Candidate[]) {\n-    return list;\n+    return list.sort();\n }\n';
        t.tool('turn-1', 'ApplyPatch', { summary: 'score.ts' }, { changes: [{ path: join(t.repo, 'score.ts'), kind: 'update', diff }] });
        await t.service.idle();

        const runs = (await t.service.read('p1', join(t.repo, 'score.ts'))).runs;
        expect(spans(runs)).toEqual([[6, 6]]);
        expect(runs[0]!.before).toEqual(['    return list;']);
    });

    test("a person's own edit in the same file is not taken for the agent's", async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write(
            'score.ts',
            SCORE.replace('    return c.hits;', '    return c.hits * 2;').replace('export function rank(', '// sorted by score\nexport function rank(')
        );
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return c.hits;', new_string: '    return c.hits * 2;' });
        await t.service.idle();

        expect(spans((await t.service.read('p1', join(t.repo, 'score.ts'))).runs)).toEqual([[2, 2]]);
    });

    test('a second edit of the same turn adds its own run next to the first', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        const first = SCORE.replace('    return c.hits;', '    return c.hits * 2;');
        await t.write('score.ts', first);
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return c.hits;', new_string: '    return c.hits * 2;' });
        const second = first.replace('    return list;', '    return list.slice();');
        await t.write('score.ts', second);
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return list;', new_string: '    return list.slice();' });
        await t.service.idle();

        expect(spans((await t.service.read('p1', join(t.repo, 'score.ts'))).runs)).toEqual([
            [2, 2],
            [6, 6]
        ]);
    });

    test('a shell edit only the checkpoint shows is noted when the turn settles, and said to be a guess', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return list;', '    return [...list];'));
        await t.endTurn('turn-1');
        await t.service.idle();

        const runs = (await t.service.read('p1', join(t.repo, 'score.ts'))).runs;
        expect(spans(runs)).toEqual([[6, 6]]);
        expect(runs[0]).toMatchObject({ via: 'checkpoint', before: ['    return list;'], turn: 1 });
    });

    test('lines a tool call marked are not marked a second time by the checkpoint', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return c.hits;', '    return c.hits * 2;'));
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return c.hits;', new_string: '    return c.hits * 2;' });
        await t.endTurn('turn-1');
        await t.service.idle();

        const runs = (await t.service.read('p1', join(t.repo, 'score.ts'))).runs;
        expect(runs.map((run) => run.via)).toEqual(['tool']);
    });

    test('a turn that ends tells the clients the file is no longer live', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return c.hits;', '    return c.hits * 2;'));
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return c.hits;', new_string: '    return c.hits * 2;' });
        await t.endTurn('turn-1', false);
        await t.service.idle();

        expect(t.heard.map((event) => (event.event === 'provenance.changed' ? event.payload.live : null))).toEqual([true, false]);
    });

    test('a tool call that is still running says the file is being written, and writes nothing yet', async () => {
        const t = await setup();
        await t.startTurn('turn-1');
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: 'a', new_string: 'b' }, { state: 'running' });
        await t.service.idle();

        expect(t.heard).toHaveLength(1);
        expect((await t.service.read('p1', join(t.repo, 'score.ts'))).runs).toEqual([]);
    });

    test('a chat no project holds, a file outside the folder and a failed call note nothing', async () => {
        const t = await setup({ project: false });
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('c.hits', 'c.hits * 2'));
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: 'c.hits', new_string: 'c.hits * 2' });
        await t.service.idle();
        expect(t.heard).toEqual([]);

        const inProject = await setup();
        await inProject.startTurn('turn-1');
        inProject.tool('turn-1', 'Edit', { file_path: '/elsewhere/score.ts', old_string: 'a', new_string: 'b' });
        inProject.tool('turn-1', 'Edit', { file_path: join(inProject.repo, 'score.ts'), old_string: 'a', new_string: 'b' }, { state: 'error' });
        await inProject.service.idle();
        expect(inProject.heard).toEqual([]);
    });
});

describe('a folder without git', () => {
    test('an edit is found by the lines it added, and the next one by what changed since the record', async () => {
        const t = await setup({ git: false });
        await t.startTurn('turn-1');
        const first = SCORE.replace('    return c.hits;', '    return c.hits * 2;');
        await t.write('score.ts', first);
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return c.hits;', new_string: '    return c.hits * 2;' });
        await t.service.idle();
        const second = first.replace('    return list;', '    return list.slice();').replace('rank(', 'rankAll(');
        await t.write('score.ts', second);
        t.tool('turn-1', 'Edit', { file_path: join(t.repo, 'score.ts'), old_string: '    return list;', new_string: '    return list.slice();' });
        await t.service.idle();

        const runs = (await t.service.read('p1', join(t.repo, 'score.ts'))).runs;
        expect(spans(runs)).toEqual([
            [2, 2],
            [6, 6]
        ]);
        expect(runs[1]!.before).toEqual(['    return list;']);
    });

    test('a write of the whole file marks all of it', async () => {
        const t = await setup({ git: false });
        await t.startTurn('turn-1');
        await t.write('score.ts', 'a\nb\n');
        t.tool('turn-1', 'Write', { file_path: join(t.repo, 'score.ts'), content: 'a\nb\n' });
        await t.service.idle();

        expect(spans((await t.service.read('p1', join(t.repo, 'score.ts'))).runs)).toEqual([[1, 2]]);
    });
});

describe('what happens to a run afterwards', () => {
    async function withRun(): Promise<Setup & { path: string }> {
        const t = await setup();
        await t.startTurn('turn-1');
        await t.write('score.ts', SCORE.replace('    return list;', '    const sorted = [...list];\n    return sorted.sort();'));
        t.tool('turn-1', 'Edit', {
            file_path: join(t.repo, 'score.ts'),
            old_string: '    return list;',
            new_string: '    const sorted = [...list];\n    return sorted.sort();'
        });
        await t.service.idle();
        return { ...t, path: join(t.repo, 'score.ts') };
    }

    test('lines added above move the run, and an edit inside it cuts it in two', async () => {
        const t = await withRun();
        const text = SCORE.replace('    return list;', '    const sorted = [...list];\n    return sorted.sort();');
        await t.write('score.ts', `// header\n${text}`);
        expect(spans((await t.service.read('p1', t.path)).runs)).toEqual([[7, 8]]);

        await t.write('score.ts', `// header\n${text.replace('    const sorted = [...list];', '    const sorted = list.slice();')}`);
        expect(spans((await t.service.read('p1', t.path)).runs)).toEqual([[8, 8]]);
    });

    test('a run whose lines were all rewritten is dropped', async () => {
        const t = await withRun();
        await t.write('score.ts', SCORE);
        expect((await t.service.read('p1', t.path)).runs).toEqual([]);
    });

    test('a commit that holds the lines hands them to git blame', async () => {
        const t = await withRun();
        expect(spans((await t.service.read('p1', t.path)).runs)).toEqual([[6, 7]]);

        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'sort']);
        expect((await t.service.read('p1', t.path)).runs).toEqual([]);
    });

    test('lines the commit does not hold stay marked', async () => {
        const t = await withRun();
        await t.startTurn('turn-2', 'Rename it');
        const text = (await Bun.file(t.path).text()).replace('    return sorted.sort();', '    return sorted.sort().reverse();');
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'sort']);
        await t.write('score.ts', text);
        t.tool('turn-2', 'Edit', { file_path: t.path, old_string: '    return sorted.sort();', new_string: '    return sorted.sort().reverse();' });
        await t.service.idle();

        const runs = (await t.service.read('p1', t.path)).runs;
        expect(runs.map((run) => [run.turnId, run.start, run.end])).toEqual([['turn-2', 7, 7]]);
    });

    test('runs older than thirty days are dropped', async () => {
        const t = await withRun();
        t.clock.now += 31 * DAY_MS;
        expect((await t.service.read('p1', t.path)).runs).toEqual([]);
    });

    test('a file that is gone loses its record', async () => {
        const t = await withRun();
        await unlink(t.path);
        expect(await t.service.read('p1', t.path)).toEqual({ mtime: 0, lines: 0, runs: [] });
    });

    test('a review sets the state of every piece of a run and tells the clients', async () => {
        const t = await withRun();
        const [run] = (await t.service.read('p1', t.path)).runs;
        t.heard.length = 0;

        expect(await t.service.review('p1', t.path, [run!.id], 'kept')).toBe(1);
        expect((await t.service.read('p1', t.path)).runs.map((entry) => entry.review)).toEqual(['kept']);
        expect(t.heard.map((event) => (event.event === 'provenance.changed' ? event.payload.live : null))).toEqual([false]);
    });

    test('forgetting a project drops the records of all its files and leaves nothing to read', async () => {
        const t = await withRun();
        expect((await t.service.read('p1', t.path)).runs).toHaveLength(1);

        await t.service.forget('p1');
        expect((await t.service.read('p1', t.path)).runs).toEqual([]);
        await t.service.forget('p1');
    });

    test('a client cannot ask about a path outside the project', async () => {
        const t = await withRun();
        await expect(t.service.read('p1', '/etc/hosts')).rejects.toMatchObject({ code: 'forbidden' });
        await expect(t.service.read('other', t.path)).rejects.toMatchObject({ code: 'forbidden' });
    });
});
