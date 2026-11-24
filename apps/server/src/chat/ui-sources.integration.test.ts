import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, GitStatus } from '@ruimte/contracts';
import { fileChange } from '../git/diff.ts';
import { gitIn, initRepo } from '../git/test-repo.ts';
import { ruimteUiSources, type UiSourceHosts } from './ui-sources.ts';

let template: string;
let repository: string;
let root: string;
let folder: string;
let reads: string[];
let hosts: UiSourceHosts;
const info = (): ChatInfo => ({ chatId: 'writer', cwd: folder }) as ChatInfo;

function statusOf(overrides: Partial<GitStatus> = {}): GitStatus {
    return {
        repo: false,
        root: null,
        branch: null,
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        base: null,
        mergeBase: null,
        files: [],
        truncated: false,
        live: false,
        ...overrides
    };
}

beforeAll(async () => {
    template = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ui-sources-template-')));
    repository = join(template, 'repo');
    await initRepo(repository, { 'a.md': 'initial' });
});

afterAll(async () => {
    await rm(template, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ui-sources-')));
    folder = join(root, 'project');
    await mkdir(folder);
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(folder, 'escaped'));
    reads = [];
    hosts = {
        place: () => ({ projectId: 'p', folder }),
        node: (id) =>
            id === 'local'
                ? { projectId: 'p', title: 'Local', canvasId: null, hidden: false }
                : id === 'child'
                  ? { projectId: 'p', title: 'Child', canvasId: null, hidden: true }
                  : id === 'other'
                    ? { projectId: 'other', title: 'Other', canvasId: null, hidden: false }
                    : null,
        worktreePaths: async () => [],
        gitStatus: async (cwd) => {
            reads.push(cwd);
            return statusOf();
        },
        gitLog: async () => ({ commits: [], cursor: null }),
        gitDiff: fileChange,
        tasks: (chatId) => {
            reads.push(chatId);
            return [];
        },
        launches: async () => [{ launchId: 'api-id', name: 'API', kind: 'service', approved: true, port: null, url: null, members: [], status: null }],
        extensionSources: () => ({
            supplies: async (name) => name === 'acme.tracker/issues',
            read: async (name, args, projectId) => {
                reads.push(`${name} ${JSON.stringify(args)} ${projectId}`);

                return [{ id: 'T-1' }];
            }
        }),
        databases: () => ({
            captureUiAccess: async () => [],
            authorizeUiRead: async () => {},
            query: async () => {
                throw new Error('unused');
            }
        })
    };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test("git reads stay in the agent's original cwd and project", async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    const current = { ...info(), cwd: join(root, 'outside') };
    await host.sources['git.status']!.authorize(current, access, { repo: '.' });
    await host.sources['git.status']!.read(current, { repo: '.' }, new AbortController().signal, access);
    expect(reads).toEqual([folder]);
});

test('a symlink and an absolute path cannot escape the project', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    await expect(host.sources['git.status']!.authorize(info(), access, { repo: 'escaped' })).rejects.toThrow('outside');
    await expect(host.sources['git.status']!.authorize(info(), access, { repo: join(root, 'outside') })).rejects.toThrow('outside');
    expect(reads).toEqual([]);
});

test("a worktree added later cannot expand the agent's original roots", async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    hosts.worktreePaths = async () => [join(root, 'outside')];
    await expect(host.sources['git.status']!.authorize(info(), access, { repo: join(root, 'outside') })).rejects.toMatchObject({ reason: 'outside-project' });
});

test('a repository that is gone fails its read instead of refusing it', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    await expect(host.sources['git.status']!.authorize(info(), access, { repo: 'gone' })).resolves.toBeUndefined();
    await expect(host.sources['git.status']!.read(info(), { repo: 'gone' }, new AbortController().signal, access)).rejects.toThrow('not there');
    expect(reads).toEqual([]);
});

test("a moved chat does not read the old project's queries or links", async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    hosts.place = () => ({ projectId: 'other', folder });
    await expect(host.sources['chat.tasks']!.authorize(info(), access, {})).rejects.toMatchObject({
        reason: 'access-unavailable',
        message: expect.stringContaining('another project')
    });
    expect(await host.link!(info(), access, { type: 'Node', id: 'local' })).toMatchObject({ state: 'plain', code: 'access-unavailable' });
});

test('a source of an extension reads for the project the block was written in, and not once the chat moved or the source went', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    const source = host.sources.extension!;
    const args = source.args.parse({ source: 'acme.tracker/issues', args: { state: 'open' } }) as Record<string, never>;

    await source.authorize(info(), access, args);
    expect(await source.read(info(), args, new AbortController().signal, access)).toEqual([{ id: 'T-1' }]);
    expect(reads).toEqual(['acme.tracker/issues {"state":"open"} p']);
    expect(source.args.parse({ source: 'acme.tracker/issues' })).toEqual({ source: 'acme.tracker/issues', args: {} });

    await expect(source.authorize(info(), access, { source: 'acme.tracker/gone', args: {} } as never)).rejects.toThrow(
        'No extension supplies this source now.'
    );
    hosts.place = () => ({ projectId: 'other', folder });
    await expect(source.authorize(info(), access, args)).rejects.toThrow('moved to another project');
    await expect(source.read(info(), args, new AbortController().signal, access)).rejects.toThrow('moved to another project');
});

test('tasks can read only their writing chat and launches only their project', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(host.sources['chat.tasks']!.args.safeParse({ parentId: 'other' }).success).toBe(false);
    expect(await host.sources['chat.tasks']!.read(info(), {}, new AbortController().signal, access)).toEqual([]);
    expect(reads).toEqual(['writer']);
    expect(await host.sources['launch.status']!.read(info(), { name: 'api' }, new AbortController().signal, access)).toMatchObject({
        launchId: 'api-id',
        state: 'unstarted'
    });
    await expect(host.sources['launch.status']!.read(info(), { name: 'web' }, new AbortController().signal, access)).rejects.toMatchObject({
        reason: 'no-unique-match'
    });
});

test('file links resolve to a canonical project file, and refuse symlinks outside it', async () => {
    await writeFile(join(folder, 'readme.md'), 'readme');
    await writeFile(join(root, 'outside', 'secret.md'), 'outside');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'File', path: 'readme.md', line: 4 })).toMatchObject({
        state: 'chip',
        target: { type: 'File', path: join(folder, 'readme.md'), line: 4 }
    });
    await expect(host.link!(info(), access, { type: 'File', path: 'escaped/secret.md' })).rejects.toMatchObject({ reason: 'outside-project' });
    await expect(host.link!(info(), access, { type: 'File', path: '.' })).rejects.toMatchObject({
        reason: 'link-unsupported',
        message: 'This target is not a file.'
    });
});

test('node links never cross a project and are checked again after removal', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Node', id: 'local' })).toMatchObject({ state: 'chip', label: 'Local' });
    // A hidden task child has no view a click could focus, so it stays text.
    expect(await host.link!(info(), access, { type: 'Node', id: 'child' })).toMatchObject({ state: 'plain', label: 'Child' });
    await expect(host.link!(info(), access, { type: 'Node', id: 'other' })).rejects.toThrow('outside');
    hosts.node = () => null;
    await expect(host.link!(info(), access, { type: 'Node', id: 'local' })).rejects.toMatchObject({ reason: 'target-unavailable' });
});

test('a file removed after its initial validation is refused at open time', async () => {
    const path = join(folder, 'readme.md');
    await writeFile(path, 'readme');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect((await host.link!(info(), access, { type: 'File', path: 'readme.md' })).state).toBe('chip');
    await unlink(path);
    await expect(host.link!(info(), access, { type: 'File', path: 'readme.md' })).rejects.toThrow('no longer available');
});

test("commit links resolve only a real commit of the agent's repository", async () => {
    await cp(repository, folder, { recursive: true });
    const sha = (await gitIn(folder, ['rev-parse', 'HEAD'])).trim();
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Commit', sha: sha.slice(0, 8) })).toMatchObject({
        state: 'chip',
        target: { type: 'Commit', sha },
        cwd: folder,
        label: 'init'
    });
    await expect(host.link!(info(), access, { type: 'Commit', sha: 'aaaaaaaa' })).rejects.toThrow('no longer available');
});

test('diff links retain a deleted file and select the staged side', async () => {
    await cp(repository, folder, { recursive: true });
    await unlink(join(folder, 'a.md'));
    hosts.gitStatus = async () =>
        statusOf({ repo: true, root: folder, branch: 'main', files: [{ path: 'a.md', state: 'staged', status: 'D', added: 0, deleted: 1, binary: false }] });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Diff', path: 'a.md' })).toMatchObject({
        state: 'chip',
        target: { type: 'Diff', path: join(folder, 'a.md') },
        cwd: folder,
        staged: true,
        relativePath: 'a.md'
    });
    await expect(host.link!(info(), access, { type: 'Diff', path: 'other.md' })).rejects.toMatchObject({
        reason: 'target-unavailable',
        message: 'This file has no current diff.'
    });
});

test('an open diff reads the change of its file in the working tree, in a commit and between revisions', async () => {
    await cp(repository, folder, { recursive: true });
    await writeFile(join(folder, 'a.md'), 'second');
    await gitIn(folder, ['commit', '--quiet', '--all', '--message', 'second']);
    await writeFile(join(folder, 'a.md'), 'third  spaced');
    hosts.gitStatus = async () =>
        statusOf({ repo: true, root: folder, branch: 'main', files: [{ path: 'a.md', state: 'unstaged', status: 'M', added: 1, deleted: 1, binary: false }] });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    const working = await host.diff!(info(), access, { path: 'a.md' });
    expect(working.patch).toContain('-second');
    expect(working.patch).toContain('+third  spaced');
    const commit = await host.diff!(info(), access, { path: 'a.md', to: 'HEAD' });
    expect(commit.patch).toContain('-initial');
    expect(commit.patch).toContain('+second');
    const between = await host.diff!(info(), access, { path: 'a.md', from: 'HEAD~1', to: 'HEAD' });
    expect(between.patch).toBe(commit.patch);
    const since = await host.diff!(info(), access, { path: 'a.md', from: 'HEAD~1' });
    expect(since.patch).toContain('-initial');
    expect(since.patch).toContain('+third  spaced');
});

test('an open diff refuses a revision that is none, an option in its place and a file outside the project', async () => {
    await cp(repository, folder, { recursive: true });
    await writeFile(join(root, 'outside', 'secret.md'), 'secret');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    await expect(host.diff!(info(), access, { path: 'a.md', from: 'no-such-branch' })).rejects.toMatchObject({
        reason: 'target-unavailable',
        message: 'no-such-branch is not a commit in this repository.'
    });
    await expect(host.diff!(info(), access, { path: 'a.md', from: '--output=leak.txt' })).rejects.toMatchObject({ reason: 'target-unavailable' });
    await expect(host.diff!(info(), access, { path: 'escaped/secret.md', to: 'HEAD' })).rejects.toMatchObject({ reason: 'outside-project' });
    await expect(host.diff!(info(), access, { path: 'a.md' })).rejects.toMatchObject({ message: 'This file has no current diff.' });
});

test("commit and diff links resolve in a repository beside the agent's own", async () => {
    await cp(repository, folder, { recursive: true });
    const nested = join(folder, 'lib');
    await cp(repository, nested, { recursive: true });
    await writeFile(join(nested, 'b.md'), 'initial');
    await gitIn(nested, ['add', 'b.md']);
    await gitIn(nested, ['commit', '--quiet', '--amend', '--no-edit']);
    const sha = (await gitIn(nested, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(nested, 'b.md'), 'changed');
    hosts.gitStatus = async (cwd) =>
        statusOf({
            repo: true,
            root: cwd,
            branch: 'main',
            files: cwd === nested ? [{ path: 'b.md', state: 'unstaged', status: 'M', added: 1, deleted: 1, binary: false }] : []
        });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Commit', sha })).toMatchObject({ state: 'chip', cwd: nested, label: 'init' });
    expect(await host.link!(info(), access, { type: 'Diff', path: 'lib/b.md' })).toMatchObject({ state: 'chip', cwd: nested, relativePath: 'b.md' });
});

test('a capture refused for its place leaves no database capture unhandled', async () => {
    const { promise: databases, reject } = Promise.withResolvers<never>();
    hosts.databases = () => ({
        captureUiAccess: () => databases,
        authorizeUiRead: async () => {},
        query: async () => {
            throw new Error('unused');
        }
    });
    const host = ruimteUiSources(hosts);
    const captured = host.capture({ ...info(), cwd: join(root, 'outside') });
    await expect(captured).rejects.toThrow('outside its project');
    // Rejected after the capture gave up on its place, which nothing would have handled.
    reject(new Error('connections unreadable'));
    await Promise.resolve();
});

test('git.status reads the branch, the counts and the first files of a busy checkout', async () => {
    const files = Array.from({ length: 2000 }, (_, index) => ({
        path: `src/generated/module-${index}/a-rather-long-file-name-${index}.ts`,
        state: index % 3 === 0 ? ('staged' as const) : ('unstaged' as const),
        status: 'M',
        added: 1,
        deleted: 1,
        binary: false
    }));
    hosts.gitStatus = async () => statusOf({ repo: true, branch: 'main', ahead: 2, files });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    const source = host.sources['git.status']!;
    const status = source.result.parse(await source.read(info(), { repo: '.' }, new AbortController().signal, access));
    expect(status).toMatchObject({ branch: 'main', ahead: 2, counts: { staged: 667, unstaged: 1333, untracked: 0, conflicted: 0 }, truncated: true });
    expect((status as { files: unknown[] }).files).toHaveLength(50);
    expect(JSON.stringify(status).length).toBeLessThan(64 * 1024);
});
