import { describe, expect, test } from 'bun:test';
import type { Worktree } from '@ruimte/contracts';
import { ProjectFileTabSchema } from '@ruimte/contracts';
import { tabKey } from '@/state/files';
import {
    leftBehindLine,
    nodesInWorktree,
    originLabel,
    removedToast,
    removeQuestion,
    workBadges,
    workBadgesLabel,
    worktreeDiffTab,
    worktreeOfPath,
    worktreesLeftBy,
    workSentence
} from './worktree-rows.ts';

const lexer: Worktree = { path: '/home/worktrees/repo-1/lexer', branch: 'lexer', from: { branch: 'main', commit: 'abc' }, nodeId: 'chat-lexer' };

describe('removeQuestion', () => {
    test('with work in it, the question names the three numbers and asks for force', () => {
        expect(removeQuestion({ ...lexer, work: { changed: 3, untracked: 2, ahead: 1 } })).toEqual({
            title: 'Remove worktree lexer?',
            description: 'It holds 3 uncommitted files, 2 new files and 1 commit that main lacks. They are lost, and so is the branch.',
            confirmLabel: 'Remove anyway',
            force: true,
            note: 'Files git ignores in it, such as .env or a local database, go too and are not counted above.'
        });
    });

    test('only what is not zero is named, in the singular where it is one', () => {
        expect(removeQuestion({ ...lexer, work: { changed: 0, untracked: 1, ahead: 0 } }).description).toBe(
            'It holds 1 new file. They are lost, and so is the branch.'
        );
    });

    test('a clean worktree is a plain confirm without force', () => {
        expect(removeQuestion({ ...lexer, work: { changed: 0, untracked: 0, ahead: 0 } })).toMatchObject({ confirmLabel: 'Remove', force: false });
        expect(removeQuestion({ ...lexer, work: { changed: 0, untracked: 0, ahead: 0 } }).note).toBeUndefined();
    });

    test('a worktree whose folder is gone only has commits to lose', () => {
        const question = removeQuestion({ ...lexer, missing: true, work: { changed: 0, untracked: 0, ahead: 2 } });
        expect(question.description).toBe(
            'Its folder is already gone, and the branch holds 2 commits that main lacks. Those commits are lost with the branch.'
        );
        expect(question.force).toBe(true);
        expect(question.note).toBeUndefined();
    });

    test('without a register the commits are counted against the base branch', () => {
        expect(workSentence({ path: '/wt', branch: 'x' }, { changed: 1, untracked: 0, ahead: 4 })).toBe(
            '1 uncommitted file and 4 commits that the base branch lacks'
        );
    });

    test('a merge that stopped halfway is work too', () => {
        expect(removeQuestion({ ...lexer, work: { changed: 0, untracked: 0, ahead: 0, operation: 'merge' } })).toMatchObject({
            description: 'It holds a merge that stopped halfway. They are lost, and so is the branch.',
            force: true
        });
    });
});

describe('removedToast', () => {
    test('says the branch stayed, or how to bring back the one that went', () => {
        expect(removedToast('lexer', { branchDeleted: false })).toEqual({ description: 'The branch lexer stays.' });
        expect(removedToast('lexer', { branchDeleted: true, branchCommit: '18e2698a0b1c2d3e4f' })).toEqual({
            description: 'Deleted the branch too. "git branch lexer 18e2698a0b1c" brings it back.'
        });
        expect(removedToast('lexer', {})).toBeNull();
    });
});

describe('rows', () => {
    test('the badges leave out what is zero, and being behind is one of them', () => {
        expect(workBadges({ changed: 3, untracked: 0, ahead: 1 })).toEqual([
            { kind: 'changed', text: '3' },
            { kind: 'ahead', text: '1' }
        ]);
        expect(workBadges({ changed: 0, untracked: 2, ahead: 0, behind: 4, operation: 'rebase' })).toEqual([
            { kind: 'operation', text: 'rebase' },
            { kind: 'untracked', text: '2' },
            { kind: 'behind', text: '4' }
        ]);
        expect(workBadges({ changed: 0, untracked: 0, ahead: 0 })).toEqual([]);
    });

    test('the words behind the badges say what the marks leave out, being behind included', () => {
        expect(workBadgesLabel(lexer, { changed: 3, untracked: 0, ahead: 1 })).toBe('3 uncommitted files and 1 commit that main lacks');
        expect(workBadgesLabel(lexer, { changed: 0, untracked: 0, ahead: 0, behind: 4 })).toBe('4 commits behind main');
        expect(workBadgesLabel(lexer, { changed: 2, untracked: 0, ahead: 0, behind: 1 })).toBe('2 uncommitted files and 1 commit behind main');
    });

    test('a folder is in the worktree it equals or sits under, and never in one whose folder is gone', () => {
        expect(worktreeOfPath([lexer], '/home/worktrees/repo-1/lexer/')).toBe(lexer);
        expect(worktreeOfPath([lexer], '/home/worktrees/repo-1/lexer/src')).toBe(lexer);
        expect(worktreeOfPath([lexer], '/home/worktrees/repo-1/lexer-2')).toBeNull();
        expect(worktreeOfPath([{ ...lexer, missing: true }], '/home/worktrees/repo-1/lexer')).toBeNull();
        expect(worktreeOfPath([lexer], undefined)).toBeNull();
    });

    test('the nodes of a worktree are the one it was made for and every agent working inside it', () => {
        const nodes = [
            { id: 'chat-lexer', kind: 'chat', title: 'Lexer' },
            { id: 'terminal-2', kind: 'terminal', title: 'Helper', cwd: '/home/worktrees/repo-1/lexer' },
            { id: 'note-1', kind: 'note', title: 'Note', cwd: '/home/worktrees/repo-1/lexer' },
            { id: 'chat-other', kind: 'chat', title: 'Other', cwd: '/repo' }
        ];
        expect(nodesInWorktree(nodes, lexer).map((node) => node.id)).toEqual(['chat-lexer', 'terminal-2']);
    });
});

describe('viewing a worktree against where it came from', () => {
    test('the tab is the whole checkout against the branch it was made from, and a reload keeps that base', () => {
        const tab = worktreeDiffTab(lexer);
        expect(tab).toEqual({ path: lexer.path, view: { kind: 'diff', cwd: lexer.path, scope: 'base', staged: false, base: 'main' } });
        expect(tabKey(tab.path, tab.view)).toBe(`checkout:${lexer.path}`);
        // What the local file stores is what the tab reads back after a reload.
        const stored = ProjectFileTabSchema.parse(JSON.parse(JSON.stringify({ path: tab.path, pinned: false, view: tab.view })));
        expect(stored.view?.base).toBe('main');
        expect(tabKey(stored.path, stored.view)).toBe(tabKey(tab.path, tab.view));
    });

    test('a detached origin measures from its commit, and a hand-made worktree from the base branch', () => {
        expect(worktreeDiffTab({ ...lexer, from: { commit: 'abc' } }).view.base).toBe('abc');
        expect(worktreeDiffTab({ path: '/x', branch: 'x' }).view.base).toBeUndefined();
    });

    test('the row says where the worktree came from; how far it is behind is a badge of its own', () => {
        expect(originLabel(lexer)).toBe('from main');
        expect(originLabel({ ...lexer, work: { changed: 0, untracked: 0, ahead: 0, behind: 4 } })).toBe('from main');
        expect(originLabel({ path: '/x', branch: 'x' })).toBeNull();
    });
});

describe('what deleting a node says about its worktree', () => {
    test('offers the worktrees only going nodes work in', () => {
        const parser: Worktree = { path: '/home/worktrees/repo-1/parser', branch: 'parser' };
        const going = [{ id: 'chat-lexer', kind: 'chat', title: 'Lexer' }];
        const staying = [{ id: 'term', kind: 'terminal', title: 'Shell', cwd: parser.path }];
        expect(worktreesLeftBy([lexer, parser], [...going, { id: 'p', kind: 'chat', title: 'P', cwd: parser.path }], staying)).toEqual([lexer]);
    });

    test('names the work of one that holds some and says it stays', () => {
        expect(leftBehindLine({ ...lexer, work: { changed: 0, untracked: 2, ahead: 0 } })).toBe(
            'Works in worktree lexer, which holds 2 new files. It stays; merge or remove it from the git panel.'
        );
        expect(leftBehindLine({ ...lexer, work: { changed: 0, untracked: 0, ahead: 0 } })).toBe('Works in worktree lexer, which holds no work.');
    });
});
