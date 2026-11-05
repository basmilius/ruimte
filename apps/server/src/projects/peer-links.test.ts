import { beforeEach, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PeerLinks } from './peer-links.ts';

const newHome = tempHomes('ruimte-links-');
let home: string;

beforeEach(async () => {
    home = await newHome();
});

test('a folder with a very long path is recorded, and is still known after a restart', async () => {
    const cwd = join(home, 'worktrees', 'repo-1234abcd', `ruimte-${'b'.repeat(240)}`);
    const links = new PeerLinks(home);
    await links.untrustFolder(cwd);
    const names = await readdir(join(home, 'peer-worktrees'));
    expect(names).toHaveLength(1);
    expect(names[0]!.length).toBeLessThan(100);

    const reloaded = new PeerLinks(home);
    await reloaded.load();
    expect(reloaded.worktreeFolders()).toEqual([cwd]);
});

test('the same folder written twice is one record', async () => {
    const links = new PeerLinks(home);
    await links.untrustFolder('/a/b');
    await links.untrustFolder('/a/b');
    expect(await readdir(join(home, 'peer-worktrees'))).toHaveLength(1);
});

test('a task recorded after its link went still leaves its worktree untrusted', async () => {
    const links = new PeerLinks(home);
    await links.recordTask('machine-a', 'node', { projectId: 'p', cwd: '/worktrees/task', worktree: true });
    expect(links.taskRecord('machine-a', 'node')).toBeNull();
    expect(links.worktreeFolders()).toEqual(['/worktrees/task']);
});

test('the branch of an untrusted folder is kept across a restart and when the folder is written again without one', async () => {
    const links = new PeerLinks(home);
    await links.untrustFolder('/worktrees/task', 'ruimte/fix-it');
    await links.recordTask('machine-a', 'node', { projectId: 'p', cwd: '/worktrees/task', worktree: true });
    expect(links.peerBranches()).toEqual(['ruimte/fix-it']);

    const reloaded = new PeerLinks(home);
    await reloaded.load();
    expect(reloaded.peerBranches()).toEqual(['ruimte/fix-it']);
});
