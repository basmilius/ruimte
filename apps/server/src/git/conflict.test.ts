import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitActionPhase } from '@ruimte/contracts';
import { GitActions } from './actions.ts';
import { conflictedFiles, operationOf, readConflict, readConflicts, resolveConflict, runOperation } from './conflict.ts';
import { forgetBase, readStatus } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let actions: GitActions;

const run = (args: string[]): Promise<string> => gitIn(repo, args);

const phases: GitActionPhase[] = [];
const sink = (phase: GitActionPhase): void => {
    phases.push(phase);
};

const merge = async (ref: string) => await actions.run({ cwd: repo, actionId: 'merge-1', kind: 'merge', ref }, () => undefined);

beforeAll(async () => {
    template = await repoTemplate('ruimte-conflict', async (dir) => {
        const path = join(dir, 'repo');
        await initRepo(path, { 'file.txt': 'one\ntwo\nthree\n', 'kept.txt': 'kept\n' });
        await gitIn(path, ['checkout', '--quiet', '-b', 'other']);
        await writeFile(join(path, 'file.txt'), 'one\ntheir two\nthree\n');
        await gitIn(path, ['commit', '--quiet', '--all', '--message', 'their change']);
        await gitIn(path, ['checkout', '--quiet', 'main']);
        await writeFile(join(path, 'file.txt'), 'one\nour two\nthree\n');
        await gitIn(path, ['commit', '--quiet', '--all', '--message', 'our change']);
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    repo = join(root, 'repo');
    actions = new GitActions();
    phases.length = 0;
    forgetBase();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('a merge that conflicts', () => {
    test('is an outcome and not a failure', async () => {
        const result = await merge('other');
        expect(result.conflicts).toEqual(['file.txt']);
        expect(result.summary).toBe('1 file conflicts.');
        expect(await operationOf(repo)).toBe('merge');
    });

    test('shows up in the status as the operation that waits', async () => {
        await merge('other');
        const status = await readStatus(repo);
        expect(status.operation).toBe('merge');
        expect(status.files.filter((file) => file.state === 'conflicted').map((file) => file.path)).toEqual(['file.txt']);
    });

    test('names both sides the way a person reads them', async () => {
        await merge('other');
        const conflicts = await readConflicts(repo);
        expect(conflicts.operation).toBe('merge');
        expect(conflicts.ours).toBe('main');
        expect(conflicts.theirs).toBe('other');
        expect(conflicts.files).toEqual([{ path: 'file.txt', kind: 'text' }]);
    });

    test('hands back the three versions git holds', async () => {
        await merge('other');
        const conflict = await readConflict(repo, 'file.txt');
        expect(conflict.base).toBe('one\ntwo\nthree\n');
        expect(conflict.ours).toBe('one\nour two\nthree\n');
        expect(conflict.theirs).toBe('one\ntheir two\nthree\n');
        expect(conflict.hash).not.toBe('');
    });
});

describe('resolving', () => {
    test('writes the merged file, stages it and counts what is left', async () => {
        await merge('other');
        const conflict = await readConflict(repo, 'file.txt');
        const remaining = await resolveConflict({ cwd: repo, path: 'file.txt', content: 'one\nboth two\nthree\n', hash: conflict.hash });
        expect(remaining).toBe(0);
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('one\nboth two\nthree\n');
        expect(await conflictedFiles(repo)).toEqual([]);
    });

    test('refuses a file that moved while it was being resolved', async () => {
        await merge('other');
        const conflict = await readConflict(repo, 'file.txt');
        await writeFile(join(repo, 'file.txt'), 'somebody else\n');
        await expect(resolveConflict({ cwd: repo, path: 'file.txt', content: 'ours\n', hash: conflict.hash })).rejects.toThrow('changed on disk');
    });

    test('takes one side whole', async () => {
        await merge('other');
        await resolveConflict({ cwd: repo, path: 'file.txt', take: 'theirs' });
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('one\ntheir two\nthree\n');
        expect(await conflictedFiles(repo)).toEqual([]);
    });

    test('a file one side deleted is a choice between keeping it and dropping it', async () => {
        await run(['checkout', '--quiet', '-b', 'drop', 'main']);
        await rm(join(repo, 'kept.txt'));
        await run(['commit', '--quiet', '--all', '--message', 'drop kept']);
        await run(['checkout', '--quiet', 'main']);
        await writeFile(join(repo, 'kept.txt'), 'kept and changed\n');
        await run(['commit', '--quiet', '--all', '--message', 'change kept']);
        const result = await actions.run({ cwd: repo, actionId: 'merge-2', kind: 'merge', ref: 'drop' }, () => undefined);
        expect(result.conflicts).toEqual(['kept.txt']);

        const conflicts = await readConflicts(repo);
        expect(conflicts.files).toEqual([{ path: 'kept.txt', kind: 'deleted-by-them' }]);
        await resolveConflict({ cwd: repo, path: 'kept.txt', take: 'delete' });
        expect(await conflictedFiles(repo)).toEqual([]);
    });
});

describe('a choice of one side', () => {
    test('is refused over an edit made on disk since the file was read, and goes through without a digest', async () => {
        await merge('other');
        const conflict = await readConflict(repo, 'file.txt');
        await writeFile(join(repo, 'file.txt'), 'edited by hand\n');

        await expect(resolveConflict({ cwd: repo, path: 'file.txt', take: 'theirs', hash: conflict.hash })).rejects.toThrow('changed on disk');
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('edited by hand\n');

        // An iPhone that sends no digest takes the side as it always did.
        await resolveConflict({ cwd: repo, path: 'file.txt', take: 'theirs' });
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('one\ntheir two\nthree\n');
    });

    test('is refused for a file that is no longer unmerged', async () => {
        await merge('other');
        await resolveConflict({ cwd: repo, path: 'file.txt', take: 'ours' });
        await expect(resolveConflict({ cwd: repo, path: 'file.txt', take: 'theirs' })).rejects.toThrow('not waiting on a merge');
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('one\nour two\nthree\n');
    });
});

describe('a file that is not plain UTF-8', () => {
    /* A file added on main, changed one way on a side branch and another way on main, then merged. */
    const conflictIn = async (name: string, base: Uint8Array, ours: Uint8Array, theirs: Uint8Array): Promise<void> => {
        await writeFile(join(repo, name), base);
        await run(['add', name]);
        await run(['commit', '--quiet', '--message', `add ${name}`]);
        await run(['checkout', '--quiet', '-b', 'side']);
        await writeFile(join(repo, name), theirs);
        await run(['commit', '--quiet', '--all', '--message', 'theirs']);
        await run(['checkout', '--quiet', 'main']);
        await writeFile(join(repo, name), ours);
        await run(['commit', '--quiet', '--all', '--message', 'ours']);
        expect((await merge('side')).conflicts).toEqual([name]);
    };
    const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
    const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

    test('in Latin-1 is a choice between whole sides, and taking one keeps its bytes', async () => {
        const theirs = latin1('café\ntheir line\n');
        await conflictIn('latin.txt', latin1('café\nline\n'), latin1('café\nour line\n'), theirs);

        const conflict = await readConflict(repo, 'latin.txt');
        expect(conflict).toMatchObject({ kind: 'binary', omitted: 'binary', ours: null, theirs: null });

        await resolveConflict({ cwd: repo, path: 'latin.txt', take: 'theirs', hash: conflict.hash });
        expect([...(await readFile(join(repo, 'latin.txt')))]).toEqual([...theirs]);
    });

    test('with a byte order mark keeps it through the merge and on disk', async () => {
        await conflictIn('bom.txt', utf8('﻿one\ntwo\n'), utf8('﻿one\nour two\n'), utf8('﻿one\ntheir two\n'));

        const conflict = await readConflict(repo, 'bom.txt');
        expect(conflict.kind).toBe('text');
        expect(conflict.ours).toBe('﻿one\nour two\n');

        await resolveConflict({ cwd: repo, path: 'bom.txt', content: '﻿one\nboth two\n', hash: conflict.hash });
        expect([...(await readFile(join(repo, 'bom.txt'))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });
});

describe('finishing', () => {
    test('a merge only goes on once nothing conflicts', async () => {
        await merge('other');
        await expect(runOperation(repo, 'continue', 'op-1', sink)).rejects.toThrow('still conflict');

        await resolveConflict({ cwd: repo, path: 'file.txt', take: 'ours' });
        const result = await runOperation(repo, 'continue', 'op-2', sink);
        expect(result.summary).toBe('Finished the merge.');
        expect(await operationOf(repo)).toBeNull();
        expect((await run(['log', '-1', '--format=%s'])).trim()).toContain('Merge branch');
    });

    test('abort puts the checkout back as it was', async () => {
        await merge('other');
        const result = await runOperation(repo, 'abort', 'op-3', sink);
        expect(result.summary).toBe('Took the merge back.');
        expect(await operationOf(repo)).toBeNull();
        expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('one\nour two\nthree\n');
    });

    test('there is nothing to finish in a checkout that waits on nothing', async () => {
        await expect(runOperation(repo, 'continue', 'op-4', sink)).rejects.toThrow('No merge or rebase waits');
    });
});

describe('a rebase that conflicts', () => {
    test('calls the replayed commit theirs, since that is the side git puts it on', async () => {
        const result = await actions.run({ cwd: repo, actionId: 'rebase-1', kind: 'rebase', ref: 'other' }, () => undefined);
        expect(result.conflicts).toEqual(['file.txt']);
        expect(await operationOf(repo)).toBe('rebase');

        const conflicts = await readConflicts(repo);
        expect(conflicts.operation).toBe('rebase');
        expect(conflicts.ours).toBe('other');
        expect(conflicts.theirs).toBe('our change');
    });
});
