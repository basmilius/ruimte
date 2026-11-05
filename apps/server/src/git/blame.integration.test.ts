import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blameFile } from './blame.ts';
import { gitIn } from './test-repo.ts';

describe('a repository', () => {
    let root: string;
    let repo: string;

    function commitAs(name: string, message: string): Promise<string> {
        return gitIn(repo, ['commit', '--quiet', '--author', `${name} <${name.toLowerCase()}@example.com>`, '--message', message]);
    }

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-blame-')));
        repo = join(root, 'repo');
        await mkdir(join(repo, 'src'), { recursive: true });
        await gitIn(repo, ['init', '--quiet', '--initial-branch=main']);
        await writeFile(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n');
        await gitIn(repo, ['add', '.']);
        await commitAs('Bob', 'Start the file');
        await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\n');
        await gitIn(repo, ['add', '.']);
        await commitAs('Carol', 'Change two, add four');
        await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\ntyped\nthree\nfour\n');
        await writeFile(join(repo, 'src', 'new.ts'), 'new\n');
        await writeFile(join(repo, 'src', 'staged.ts'), 'staged\n');
        await gitIn(repo, ['add', 'src/staged.ts']);
        await writeFile(join(root, 'outside.txt'), 'outside\n');
        await symlink(join(root, 'outside.txt'), join(repo, 'link.txt'));
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('names the author of every line, and no one for a line that is typed and not committed', async () => {
        const blame = await blameFile(repo, 'src/a.ts');
        expect(blame.omitted).toBeUndefined();
        expect(blame.commits.map((commit) => [commit.author, commit.email, commit.summary])).toEqual([
            ['Bob', 'bob@example.com', 'Start the file'],
            ['Carol', 'carol@example.com', 'Change two, add four']
        ]);
        expect(blame.commits[0]?.shortHash).toHaveLength(7);
        expect(blame.lines).toEqual([0, 1, -1, 0, 1]);
    });

    test('takes a folder inside the checkout as the place to ask from', async () => {
        const blame = await blameFile(join(repo, 'src'), 'src/a.ts');
        expect(blame.lines).toHaveLength(5);
    });

    test('says why a file has no lines, and gives a staged new file lines no commit holds', async () => {
        expect((await blameFile(repo, 'src/new.ts')).omitted).toBe('untracked');
        expect(await blameFile(repo, 'src/staged.ts')).toEqual({ commits: [], lines: [-1] });
    });

    test('refuses a path that leaves the checkout, and a file that is not there', async () => {
        await expect(blameFile(repo, '../outside.txt')).rejects.toMatchObject({ code: 'outside-checkout' });
        await expect(blameFile(repo, 'src/missing.ts')).rejects.toMatchObject({ code: 'git-failed' });
    });
});
