import { describe, expect, test } from 'bun:test';
import type { GitFile, GitStatus } from '@ruimte/contracts';
import {
    actionTitle,
    amendTarget,
    commitTargets,
    isUnmergedRefusal,
    manySummary,
    phaseLabel,
    popStashStep,
    pushable,
    pushAllButton,
    pushButton,
    pushEntries,
    splitMessage
} from './git-actions';

function status(patch: Partial<GitStatus> = {}): GitStatus {
    return {
        repo: true,
        root: '/repo',
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        base: 'origin/main',
        mergeBase: null,
        files: [],
        truncated: false,
        live: true,
        ...patch
    };
}

function checkout(label: string, patch: Partial<GitStatus> | null): { path: string; label: string; status: GitStatus | null } {
    return { path: `/work/${label}`, label, status: patch === null ? null : status(patch) };
}

describe('pushing a folder of repositories', () => {
    test('every repository says for itself what a push would do', () => {
        const entries = pushEntries([checkout('one', { ahead: 2 }), checkout('two', { upstream: null }), checkout('three', {})]);
        expect(entries.map((entry) => [entry.label, entry.button.kind, entry.button.disabled, entry.ahead])).toEqual([
            ['one', 'push', false, 2],
            ['two', 'publish', false, 0],
            ['three', 'push', true, 0]
        ]);
    });

    test('a repository whose status is not in yet is nothing to push', () => {
        expect(pushable(pushEntries([checkout('one', null)]))).toEqual([]);
    });

    test('"push all" runs only the ones that would move', () => {
        const entries = pushEntries([checkout('one', { ahead: 1 }), checkout('two', {}), checkout('three', { ahead: 4 })]);
        expect(pushable(entries).map((entry) => entry.label)).toEqual(['one', 'three']);
    });

    test('"push all" leaves a branch without an upstream to its own row', () => {
        const entries = pushEntries([checkout('one', { ahead: 1 }), checkout('local', { upstream: null })]);
        expect(pushable(entries).map((entry) => entry.label)).toEqual(['one']);
        expect(pushAllButton(entries).reason).toBe('Push 1 repository');

        const unpublished = pushEntries([checkout('local', { upstream: null }), checkout('two', {})]);
        expect(pushAllButton(unpublished)).toMatchObject({ disabled: true, reason: 'Nothing to push' });
    });

    test('the summary counts what went well, and names what did not', () => {
        expect(manySummary(1, [])).toBe('Done in 1 repository');
        expect(manySummary(3, [])).toBe('Done in 3 repositories');
        expect(manySummary(1, ['two'])).toBe('1 repository failed: two');
        expect(manySummary(0, ['two', 'three'])).toBe('2 repositories failed: two, three');
    });
});

/* A repository with a file in each of these states. */
function repo(label: string, states: GitFile['state'][]): { path: string; label: string; status: GitStatus } {
    return {
        path: `/work/${label}`,
        label,
        status: status({ files: states.map((state, index) => ({ path: `${index}.ts`, state, status: 'M', added: 1, deleted: 0, binary: false })) })
    };
}

describe('where a commit lands', () => {
    test('every repository with something staged takes the commit', () => {
        const { targets, stageAll } = commitTargets([repo('one', ['staged']), repo('two', ['unstaged']), repo('three', ['staged', 'unstaged'])]);
        expect(targets.map((target) => target.label)).toEqual(['one', 'three']);
        expect(stageAll).toBe(false);
    });

    test('a single repository with nothing staged is the commit that stages first', () => {
        const { targets, stageAll } = commitTargets([repo('one', ['unstaged'])]);
        expect(targets.map((target) => target.label)).toEqual(['one']);
        expect(stageAll).toBe(true);
    });

    test('two repositories with nothing staged have no commit to make yet', () => {
        expect(commitTargets([repo('one', ['unstaged']), repo('two', ['untracked'])]).targets).toEqual([]);
    });

    test('a folder with nothing changed anywhere has none either', () => {
        expect(commitTargets([repo('one', [])]).targets).toEqual([]);
        expect(commitTargets([{ path: '/work/one', label: 'one', status: null }]).targets).toEqual([]);
    });
});

describe('which commit an amend rewrites', () => {
    test('the one repository with something staged', () => {
        expect(amendTarget([repo('one', ['unstaged']), repo('two', ['staged'])])?.label).toBe('two');
    });

    test('none when two repositories have something staged', () => {
        expect(amendTarget([repo('one', ['staged']), repo('two', ['staged'])])).toBeNull();
    });

    test('the only repository of the folder with nothing staged, to reword its last commit', () => {
        expect(amendTarget([repo('one', [])])?.label).toBe('one');
        expect(amendTarget([repo('one', ['unstaged'])])?.label).toBe('one');
    });

    test('none when nothing is staged in a folder of several repositories', () => {
        expect(amendTarget([repo('one', ['unstaged']), repo('two', [])])).toBeNull();
    });

    test('none for a folder whose status has not come in', () => {
        expect(amendTarget([{ path: '/work/one', label: 'one', status: null }])).toBeNull();
    });
});

describe('the push button', () => {
    test('a branch without an upstream is published', () => {
        const button = pushButton(status({ upstream: null }));
        expect(button.label).toBe('Publish branch');
        expect(button.kind).toBe('publish');
        expect(button.disabled).toBe(false);
    });

    test('nothing ahead is nothing to push', () => {
        const button = pushButton(status());
        expect(button.disabled).toBe(true);
        expect(button.reason).toBe('Nothing to push');
    });

    test('commits ahead push, and the reason counts them', () => {
        expect(pushButton(status({ ahead: 1 })).reason).toBe('Push 1 commit to origin/main');
        expect(pushButton(status({ ahead: 3 })).reason).toBe('Push 3 commits to origin/main');
        expect(pushButton(status({ ahead: 3 })).disabled).toBe(false);
    });

    test('a detached head and a folder without a repository have nothing to push', () => {
        expect(pushButton(status({ detached: true, branch: null, ahead: 2 })).disabled).toBe(true);
        expect(pushButton(status({ repo: false })).disabled).toBe(true);
        expect(pushButton(null).disabled).toBe(true);
    });
});

describe('what a toast says', () => {
    test('every phase and every kind has words of its own', () => {
        expect(phaseLabel('push')).toBe('Pushing');
        expect(phaseLabel('failed')).toBe('That did not work');
        expect(actionTitle('commit-push')).toBe('Committing and pushing');
    });

    test('only an unmerged branch earns a second ask', () => {
        expect(isUnmergedRefusal("error: the branch 'work' is not fully merged")).toBe(true);
        expect(isUnmergedRefusal('error: branch not found')).toBe(false);
    });
});

describe('popping a stash', () => {
    test('a single stash pops by its ref, more than one asks which', () => {
        expect(popStashStep([])).toBeNull();
        expect(popStashStep([{ ref: 'stash@{0}', message: 'WIP on main' }])).toEqual({ kind: 'pop', ref: 'stash@{0}' });
        expect(
            popStashStep([
                { ref: 'stash@{0}', message: 'WIP on main' },
                { ref: 'stash@{1}', message: 'WIP on work' }
            ])
        ).toEqual({ kind: 'pick' });
    });
});

describe('the commit message', () => {
    test('the first line is the subject and the rest is the body', () => {
        expect(splitMessage('feat: a thing\n\nBecause of this.\nAnd that.')).toEqual({ subject: 'feat: a thing', body: 'Because of this.\nAnd that.' });
        expect(splitMessage('  fix: trim me  ')).toEqual({ subject: 'fix: trim me', body: '' });
        expect(splitMessage('')).toEqual({ subject: '', body: '' });
    });
});
