import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@adecore/agents/host';
import type { ChatTurnItem } from '@ruimte/contracts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, repoTemplate, type RepoTemplate } from '../git/test-repo.ts';
import { ProvenanceService, type ProvenanceChat } from './provenance-service.ts';
import { ProvenanceStore } from './provenance-store.ts';

const SCORE = ['export function rank(list: Candidate[]) {', '    return list;', '}', ''].join('\n');
const OTHER = ['one', 'two', 'three', 'four', 'five', ''].join('\n');

let template: RepoTemplate;
const cleanups: string[] = [];

beforeAll(async () => {
    template = await repoTemplate('provenance-head', async (root) => {
        await gitIn(root, ['init', '--quiet', '--initial-branch=main']);
        await writeFile(join(root, 'score.ts'), SCORE);
        await writeFile(join(root, 'other.ts'), OTHER);
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

/* Commits a change of `other.ts` on a branch, and comes back to where it was. */
async function commitOther(repo: string, branch: string, text: string, from: string): Promise<void> {
    await gitIn(repo, ['switch', '--quiet', '--create', branch, from]);
    await writeFile(join(repo, 'other.ts'), text);
    await gitIn(repo, ['commit', '--quiet', '--all', '--message', `change on ${branch}`]);
}

/* A turn the way the chat records it: the checkpoint and HEAD at the start, the diff and HEAD at the end. */
async function setup(withHeads = true) {
    const repo = await template.copy();
    const home = await mkdtemp(join(tmpdir(), 'provenance-head-home-'));
    cleanups.push(repo, home);
    const checkpoints = new Checkpoints(home);
    const heads: { before?: string; after?: string } = {};
    let tree: string | undefined;
    const chat: ProvenanceChat = {
        provider: 'claude',
        cwd: repo,
        checkpointOf: () => tree,
        headsOf: () => (withHeads ? heads : undefined),
        turnNumberOf: () => 1,
        promptOf: () => 'Tidy up'
    };
    const service = new ProvenanceService({
        home,
        locate: () => ({ projectId: 'p1', folder: repo }),
        folderOf: () => repo,
        holders: () => [],
        chat: () => chat
    });
    return {
        repo,
        service,
        /* What the record holds right after the turn, before a read maps it through HEAD again. */
        recordedRuns: async (name: string) => (await new ProvenanceStore(home).read('p1', join(repo, name)))?.runs ?? [],
        async startTurn(): Promise<void> {
            tree = (await checkpoints.take(repo)) ?? undefined;
            heads.before = (await checkpoints.head(repo)) ?? undefined;
        },
        async endTurn(): Promise<void> {
            heads.after = (await checkpoints.head(repo)) ?? undefined;
            const answer = await checkpoints.settle(repo, tree!);
            const item: ChatTurnItem = {
                id: 'turn-1',
                createdAt: 1,
                turnId: 'turn-1',
                kind: 'turn',
                state: 'done',
                endedAt: 2,
                costUsd: 0,
                checkpoint: tree!,
                checkpointDiff: answer!.diff,
                checkpointAfter: answer!.after
            };
            service.consume({ event: 'chat.event', payload: { chatId: 'chat-a', event: { type: 'item', item } } } as AgentEvent);
            await service.idle();
        },
        runsOf: async (name: string) => (await service.read('p1', join(repo, name))).runs
    };
}

const AGENT_EDIT = SCORE.replace('    return list;', '    return [...list];');
const OTHER_BRANCH = OTHER.replace('five', 'FIVE');
const PERSON_EDIT = OTHER.replace('one', 'ONE');

describe('HEAD moving during a turn', () => {
    test('a fast-forward pull leaves no run on the files it brought in', async () => {
        const t = await setup();
        await commitOther(t.repo, 'side', OTHER_BRANCH, 'main');
        await gitIn(t.repo, ['switch', '--quiet', 'main']);
        await t.startTurn();
        await writeFile(join(t.repo, 'score.ts'), AGENT_EDIT);
        await gitIn(t.repo, ['merge', '--quiet', '--ff-only', 'side']);
        await t.endTurn();
        expect((await t.runsOf('score.ts')).map((run) => run.via)).toEqual(['checkpoint']);
        expect(await t.runsOf('other.ts')).toEqual([]);
    });

    test("a file the pull touched keeps only a person's uncommitted lines as runs, never the ones the pull brought in", async () => {
        const t = await setup();
        await commitOther(t.repo, 'side', OTHER_BRANCH, 'main');
        await gitIn(t.repo, ['switch', '--quiet', 'main']);
        await t.startTurn();
        await writeFile(join(t.repo, 'other.ts'), PERSON_EDIT);
        await gitIn(t.repo, ['merge', '--quiet', '--autostash', '--ff-only', 'side']);
        await t.endTurn();
        const runs = await t.runsOf('other.ts');
        expect(runs.map((run) => [run.start, run.end, run.via])).toEqual([[1, 1, 'checkpoint']]);
    });

    test('an edit made after the agent committed the file in the same turn is still noted, the commit is not', async () => {
        const t = await setup();
        await t.startTurn();
        await writeFile(join(t.repo, 'score.ts'), AGENT_EDIT);
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'agent commit']);
        const later = AGENT_EDIT.replace('}', '    // formatted\n}');
        await writeFile(join(t.repo, 'score.ts'), later);
        await t.endTurn();
        const runs = await t.runsOf('score.ts');
        expect(runs.map((run) => [run.start, run.end, run.via])).toEqual([[3, 3, 'checkpoint']]);
    });

    test('a file the commit holds exactly is left alone even though HEAD moved over it', async () => {
        const t = await setup();
        await t.startTurn();
        await writeFile(join(t.repo, 'score.ts'), AGENT_EDIT);
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'agent commit']);
        await t.endTurn();
        expect(await t.runsOf('score.ts')).toEqual([]);
    });

    test('a line equal to a neighbor in HEAD is recorded when the turn started from uncommitted edits', async () => {
        const t = await setup();
        await writeFile(join(t.repo, 'other.ts'), PERSON_EDIT);
        await t.startTurn();
        await writeFile(join(t.repo, 'other.ts'), PERSON_EDIT.replace('two\n', 'two\ntwo\n'));
        await t.endTurn();
        expect((await t.recordedRuns('other.ts')).map((run) => run.via)).toEqual(['checkpoint']);
    });

    test('a reset --hard leaves no run on the files it put back', async () => {
        const t = await setup();
        await commitOther(t.repo, 'work', OTHER_BRANCH, 'main');
        await t.startTurn();
        await writeFile(join(t.repo, 'score.ts'), AGENT_EDIT);
        await gitIn(t.repo, ['reset', '--quiet', '--hard', 'HEAD~1']);
        await t.endTurn();
        expect((await t.runsOf('score.ts')).map((run) => run.via)).toEqual([]);
        expect(await t.runsOf('other.ts')).toEqual([]);
    });

    test('a rebase leaves no run on the files that came in with the new base', async () => {
        const t = await setup();
        await commitOther(t.repo, 'base', OTHER_BRANCH, 'main');
        await gitIn(t.repo, ['switch', '--quiet', 'main']);
        await gitIn(t.repo, ['switch', '--quiet', '--create', 'topic']);
        await writeFile(join(t.repo, 'score.ts'), SCORE.replace('Candidate[]', 'Candidate[] = []'));
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'topic']);
        await t.startTurn();
        await gitIn(t.repo, ['rebase', '--quiet', 'base']);
        await t.endTurn();
        expect(await t.runsOf('other.ts')).toEqual([]);
        expect(await t.runsOf('score.ts')).toEqual([]);
    });

    test('a conflict resolution committed during the turn leaves no run', async () => {
        const t = await setup();
        await commitOther(t.repo, 'side', OTHER.replace('three', 'THREE'), 'main');
        await gitIn(t.repo, ['switch', '--quiet', 'main']);
        await writeFile(join(t.repo, 'other.ts'), OTHER.replace('three', 'tres'));
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'main change']);
        await gitIn(t.repo, ['merge', '--quiet', 'side']).catch(() => undefined);
        await t.startTurn();
        await writeFile(join(t.repo, 'other.ts'), OTHER.replace('three', 'resolved'));
        await gitIn(t.repo, ['commit', '--quiet', '--all', '--message', 'resolve']);
        await t.endTurn();
        expect(await t.runsOf('other.ts')).toEqual([]);
    });

    test("a person's uncommitted edit stays a checkpoint run while HEAD holds still", async () => {
        const t = await setup();
        await t.startTurn();
        await writeFile(join(t.repo, 'other.ts'), PERSON_EDIT);
        await t.endTurn();
        expect((await t.runsOf('other.ts')).map((run) => run.via)).toEqual(['checkpoint']);
    });

    test('a turn with no heads still notes the shell edit, and HEAD keeps the lines it holds', async () => {
        const t = await setup(false);
        await commitOther(t.repo, 'side', OTHER_BRANCH, 'main');
        await gitIn(t.repo, ['switch', '--quiet', 'main']);
        await t.startTurn();
        await writeFile(join(t.repo, 'score.ts'), AGENT_EDIT);
        await gitIn(t.repo, ['merge', '--quiet', '--ff-only', 'side']);
        await t.endTurn();
        expect((await t.runsOf('score.ts')).map((run) => run.via)).toEqual(['checkpoint']);
        expect(await t.runsOf('other.ts')).toEqual([]);
    });
});
