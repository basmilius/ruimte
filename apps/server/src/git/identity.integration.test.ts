import { afterAll, beforeAll, expect, jest, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitIdentity } from '@ruimte/contracts';
import { killQuietly, processAlive } from '../process-test-helpers.ts';
import { IdentityReader } from './identity.ts';
import { runGit } from './run.ts';
import { expectProcessTerminated } from './test-process.ts';
import { gitIn, initRepo } from './test-repo.ts';

let root: string;
let origin: string;

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-identity-')));
    origin = join(root, 'origin');
    await initRepo(origin, { 'a.txt': 'a\n' });
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

async function identityOf(path: string): Promise<GitIdentity> {
    const [identity] = (await new IdentityReader().read([path])).identities;
    if (identity === undefined || 'error' in identity) {
        throw new Error(`${path} is not a repository`);
    }
    return identity;
}

test('two clones of one repository share their root commit, and a repository of its own does not', async () => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await gitIn(root, ['clone', '--quiet', origin, first]);
    await gitIn(root, ['clone', '--quiet', origin, second]);
    const other = join(root, 'other');
    await initRepo(other, { 'b.txt': 'b\n' });

    const [a, b, c] = await Promise.all([identityOf(first), identityOf(second), identityOf(other)]);
    expect(a).toMatchObject({ path: first, branch: 'main', remoteUrl: origin });
    expect(a.rootCommits).toHaveLength(1);
    expect(b.rootCommits).toEqual(a.rootCommits);
    expect(c.rootCommits).not.toEqual(a.rootCommits);
    expect(a.heads).toEqual(a.rootCommits);
});

test('a repository without a remote names none, and lists HEAD first and then every branch tip', async () => {
    const repo = join(root, 'local');
    await initRepo(repo, { 'c.txt': 'c\n' });
    await gitIn(repo, ['switch', '--quiet', '--create', 'feature']);
    await gitIn(repo, ['commit', '--quiet', '--allow-empty', '--message', 'ahead']);
    const head = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    const main = (await gitIn(repo, ['rev-parse', 'main'])).trim();

    const identity = await identityOf(repo);
    expect(identity).toMatchObject({ path: repo, branch: 'feature', heads: [head, main] });
    expect('remoteUrl' in identity).toBe(false);
});

test('a detached HEAD names no branch', async () => {
    const repo = join(root, 'detached');
    await initRepo(repo, { 'd.txt': 'd\n' });
    await gitIn(repo, ['checkout', '--quiet', '--detach']);
    expect('branch' in (await identityOf(repo))).toBe(false);
});

test('the credentials of a remote stay on the machine', async () => {
    const repo = join(root, 'credentials');
    await initRepo(repo, { 'e.txt': 'e\n' });
    await gitIn(repo, ['remote', 'add', 'origin', 'https://ada:secret@example.com/owner/repo.git']);
    expect(await identityOf(repo)).toMatchObject({ remoteUrl: 'https://example.com/owner/repo.git' });
});

test('a repository without a commit has nothing to compare yet', async () => {
    const repo = join(root, 'empty');
    await mkdir(repo);
    await gitIn(repo, ['init', '--quiet']);
    expect(await identityOf(repo)).toMatchObject({ path: repo, rootCommits: [], heads: [] });
});

test('a folder outside git, and one that is not there, are not repositories', async () => {
    const plain = join(root, 'plain');
    await mkdir(plain);
    expect((await new IdentityReader().read([plain, join(root, 'missing')])).identities).toEqual([
        { path: plain, error: 'not-a-repository' },
        { path: join(root, 'missing'), error: 'not-a-repository' }
    ]);
});

test('a folder inside a repository is not a checkout of it, but the top level is', async () => {
    const dotfiles = join(root, 'dotfiles');
    await initRepo(dotfiles, { rc: 'x\n' });
    const inside = join(dotfiles, 'project');
    await mkdir(inside);
    expect((await new IdentityReader().read([dotfiles, inside])).identities).toMatchObject([
        { path: dotfiles, branch: 'main' },
        { path: inside, error: 'not-a-repository' }
    ]);
});

test('the root commits are kept while HEAD moves on, and the heads are not', async () => {
    const repo = join(root, 'moving');
    await initRepo(repo, { 'f.txt': 'f\n' });
    const reader = new IdentityReader();
    const [before] = (await reader.read([repo])).identities as GitIdentity[];
    await gitIn(repo, ['commit', '--quiet', '--allow-empty', '--message', 'more']);
    const [after] = (await reader.read([repo])).identities as GitIdentity[];
    expect(after!.rootCommits).toEqual(before!.rootCommits);
    expect(after!.heads).not.toEqual(before!.heads);
});

test.skipIf(process.platform === 'win32')('a git that takes too long is ended and says so', async () => {
    // The script becomes the sleep itself, so ending it closes the pipes. A git alias would leave a child holding them until it is done.
    const bin = join(root, 'stuck-bin');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const result = await runGit(['status'], root, { env: { PATH: `${bin}:${process.env.PATH}` }, timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
});

test.skipIf(process.platform === 'win32')('a git that left a child holding its pipes is ended with the child, and says so', async () => {
    // Like a credential helper or an alias: git itself is gone at the end, the child keeps stdout and stderr open.
    const bin = join(root, 'stuck-child-bin');
    const pidFile = join(root, 'child.pid');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), `#!/bin/sh\nsleep 30 &\necho child-ready\necho $! > '${pidFile}'\nwait\n`, { mode: 0o755 });
    jest.useFakeTimers();
    let pid = NaN;
    try {
        const running = runGit(['status'], root, { env: { PATH: `${bin}:${process.env.PATH}` }, timeoutMs: 100 });
        while (!Number.isSafeInteger(pid)) {
            pid = Number.parseInt(await readFile(pidFile, 'utf8').catch(() => ''), 10);
        }
        expect(processAlive(pid)).toBe(true);
        jest.advanceTimersByTime(100);
        const result = await running;
        expect(result.timedOut).toBe(true);
        expect(result.code).toBe(137);
        expect(result.stdout).toBe('child-ready\n');
        jest.useRealTimers();
        await expectProcessTerminated(pid, 'SIGKILL');
    } finally {
        jest.useRealTimers();
        if (Number.isSafeInteger(pid)) {
            // Containment when the group termination regresses.
            killQuietly(pid);
        }
    }
});
