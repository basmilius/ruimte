import { describe, expect, test } from 'bun:test';
import type { Worktree, WorktreeMergeResult } from '@ruimte/contracts';
import { TransportError } from '@/transport';
import type { Transport } from '@/transport/transport';
import {
    checkedOutBranch,
    defaultSubject,
    isOverwriteRefusal,
    mergeContents,
    mergedDescription,
    mergeTitle,
    runMerges,
    targetCheckout,
    type MergeOutcome,
    type MergeRun
} from './worktree-merge.ts';
import { removeAllQuestion } from './worktree-rows.ts';

const worktree = (branch: string, extra: Partial<Worktree> = {}): Worktree => ({
    path: `/wt/${branch}`,
    branch,
    from: { branch: 'main', commit: 'abc' },
    ...extra
});

const run = (branch: string): MergeRun => ({ worktree: worktree(branch), payload: { repo: '/project', path: `/wt/${branch}`, strategy: 'squash' } });

const result = (extra: Partial<WorktreeMergeResult> = {}): WorktreeMergeResult => ({ actionId: 'a', summary: 'ok', output: '', ...extra });

const transportAnswering = (answers: Record<string, () => WorktreeMergeResult>): { transport: Pick<Transport, 'request'>; asked: string[] } => {
    const asked: string[] = [];
    const transport = {
        request: (async (_type: string, payload: { path: string }) => {
            asked.push(payload.path);
            return answers[payload.path]!();
        }) as unknown as Transport['request']
    };
    return { transport, asked };
};

describe('runMerges', () => {
    test('merges in order and stops at the first conflict, leaving the rest alone', async () => {
        const { transport, asked } = transportAnswering({
            '/wt/a': () => result(),
            '/wt/b': () => result({ conflicts: ['x.ts'] }),
            '/wt/c': () => result()
        });
        const outcomes = await runMerges(
            transport,
            [run('a'), run('b'), run('c')],
            () => 'id',
            () => undefined,
            () => undefined
        );
        expect(outcomes.map((outcome) => outcome.kind)).toEqual(['merged', 'conflict']);
        expect(asked).toEqual(['/wt/a', '/wt/b']);
    });

    test('a refusal carries its code and stops the run as well', async () => {
        const { transport, asked } = transportAnswering({
            '/wt/a': () => {
                throw new TransportError('agent-working', '1 agent is still working in a.');
            },
            '/wt/b': () => result()
        });
        const outcomes = await runMerges(
            transport,
            [run('a'), run('b')],
            () => 'id',
            () => undefined,
            () => undefined
        );
        expect(outcomes).toEqual([{ kind: 'refused', worktree: worktree('a'), code: 'agent-working', message: '1 agent is still working in a.' }]);
        expect(asked).toEqual(['/wt/a']);
    });
});

describe('what the merge dialog says', () => {
    test('counts commits and loose files over every worktree', () => {
        expect(mergeContents([worktree('a', { work: { changed: 1, untracked: 2, ahead: 2 } })])).toBe('2 commits and 3 uncommitted files');
        expect(
            mergeContents([worktree('a', { work: { changed: 0, untracked: 0, ahead: 1 } }), worktree('b', { work: { changed: 0, untracked: 1, ahead: 0 } })])
        ).toBe('1 commit and 1 uncommitted file');
        expect(mergeContents([worktree('a', { work: { changed: 0, untracked: 0, ahead: 0 } })])).toBe('nothing yet');
    });

    test('names what goes where', () => {
        expect(mergeTitle([worktree('lexer')])).toBe('Merge lexer into main');
        expect(mergeTitle([worktree('a'), worktree('b'), worktree('c')])).toBe('Merge 3 worktrees into main');
        expect(mergeTitle([worktree('a'), worktree('b', { from: { branch: 'dev', commit: 'x' } })])).toBe('Merge 2 worktrees');
        expect(defaultSubject('Lexer', 'lexer')).toBe('Lexer: work of the agent');
        expect(defaultSubject('', 'lexer')).toBe('lexer: work of the agent');
    });

    test('reads the branch the project folder is on out of a refusal, and finds the checkout of a target', () => {
        expect(checkedOutBranch('main is not checked out anywhere; /repo is on feature-x.')).toBe('feature-x');
        expect(checkedOutBranch('main is not checked out anywhere; /repo is on a detached HEAD.')).toBeNull();
        expect(targetCheckout('/repo', 'main', [], 'main')).toBe('/repo');
        expect(targetCheckout('/repo', 'feature', [worktree('main')], 'main')).toBe('/wt/main');
        expect(targetCheckout('/repo', 'feature', [], 'main')).toBeNull();
    });

    test('offers a stash only for git refusing over a change it would overwrite', () => {
        const refused = (code: string, message: string): MergeOutcome => ({ kind: 'refused', worktree: worktree('a'), code, message });
        expect(isOverwriteRefusal(refused('git-failed', 'error: Your local changes to the following files would be overwritten by merge:\n\tshared.txt'))).toBe(
            true
        );
        expect(isOverwriteRefusal(refused('agent-working', 'would be overwritten by merge'))).toBe(false);
        expect(isOverwriteRefusal(refused('git-failed', 'fatal: refusing to merge unrelated histories'))).toBe(false);
    });

    test('says whether the worktree went, and why it stayed', () => {
        expect(mergedDescription(result({ removed: true, branchDeleted: true }))).toBe('Removed the worktree and its branch.');
        expect(mergedDescription(result({ removed: false, kept: '1 agent still runs in it.' }))).toBe('The worktree stays: 1 agent still runs in it.');
        expect(mergedDescription(result())).toBeUndefined();
    });
});

describe('removeAllQuestion', () => {
    test('several clean worktrees are a plain confirm, and one with work names its numbers and asks for force', () => {
        const clean = { changed: 0, untracked: 0, ahead: 0 };
        expect(removeAllQuestion([worktree('a', { work: clean }), worktree('b', { work: clean })])).toMatchObject({
            title: 'Remove 2 worktrees?',
            force: false
        });
        const question = removeAllQuestion([worktree('a', { work: clean }), worktree('b', { work: { changed: 0, untracked: 2, ahead: 1 } })]);
        expect(question).toMatchObject({ confirmLabel: 'Remove anyway', force: true });
        expect(question.description).toBe('b holds 2 new files and 1 commit that main lacks. That is lost, and so are their branches.');
    });
});
