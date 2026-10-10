import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo } from '@ruimte/contracts';
import { ruimteUiSources, type UiSourceHosts } from './ui-sources.ts';

let root: string;
let folder: string;
let reads: string[];
let hosts: UiSourceHosts;
const info = (): ChatInfo => ({ chatId: 'writer', cwd: folder }) as ChatInfo;

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
                live: false
            };
        },
        gitLog: async () => ({ commits: [], cursor: null }),
        tasks: (chatId) => {
            reads.push(chatId);
            return [];
        },
        launches: async () => [{ launchId: 'api-id', name: 'API', kind: 'service', approved: true, port: null, url: null, members: [], status: null }],
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

test('git reads stay in the writer’s original cwd and project', async () => {
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

test('a worktree added later cannot expand the writer’s original roots', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    hosts.worktreePaths = async () => [join(root, 'outside')];
    await expect(host.sources['git.status']!.authorize(info(), access, { repo: join(root, 'outside') })).rejects.toThrow('writer');
});

test('a moved chat does not read the old project’s queries', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    hosts.place = () => ({ projectId: 'other', folder });
    await expect(host.sources['chat.tasks']!.authorize(info(), access, {})).rejects.toThrow('another project');
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
});

test('file links resolve to a canonical project file, and refuse symlinks outside it', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(folder, 'readme.md'), 'readme');
    await writeFile(join(root, 'outside', 'secret.md'), 'outside');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'File', path: 'readme.md', line: 4 })).toMatchObject({
        state: 'chip',
        target: { type: 'File', path: join(folder, 'readme.md'), line: 4 }
    });
    await expect(host.link!(info(), access, { type: 'File', path: 'escaped/secret.md' })).rejects.toThrow('outside');
    await expect(host.link!(info(), access, { type: 'File', path: '.' })).rejects.toThrow('not a file');
});

test('node links never cross a project and are checked again after removal', async () => {
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Node', id: 'local' })).toMatchObject({ state: 'chip', label: 'Local' });
    // A hidden task child has no view a click could focus, so it stays text.
    expect(await host.link!(info(), access, { type: 'Node', id: 'child' })).toMatchObject({ state: 'plain', label: 'Child' });
    await expect(host.link!(info(), access, { type: 'Node', id: 'other' })).rejects.toThrow('outside');
    hosts.node = () => null;
    await expect(host.link!(info(), access, { type: 'Node', id: 'local' })).rejects.toThrow('no longer available');
});

test('a file removed after its initial validation is refused at open time', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const path = join(folder, 'readme.md');
    await writeFile(path, 'readme');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect((await host.link!(info(), access, { type: 'File', path: 'readme.md' })).state).toBe('chip');
    await unlink(path);
    await expect(host.link!(info(), access, { type: 'File', path: 'readme.md' })).rejects.toThrow('no longer available');
});

function fixtureGit(...args: string[]): Promise<string> {
    return fixtureGitIn(folder, ...args);
}

async function fixtureGitIn(cwd: string, ...args: string[]): Promise<string> {
    const process = Bun.spawn(['git', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const output = await new Response(process.stdout).text();
    if ((await process.exited) !== 0) {
        throw new Error(await new Response(process.stderr).text());
    }
    return output.trim();
}

test('commit links resolve only a real commit of the writer’s repository', async () => {
    const { writeFile } = await import('node:fs/promises');
    await fixtureGit('init', '-q');
    await writeFile(join(folder, 'a.md'), 'initial');
    await fixtureGit('add', 'a.md');
    await fixtureGit('commit', '-qm', 'Fixture commit');
    const sha = await fixtureGit('rev-parse', 'HEAD');
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Commit', sha: sha.slice(0, 8) })).toMatchObject({
        state: 'chip',
        target: { type: 'Commit', sha },
        cwd: folder,
        label: 'Fixture commit'
    });
    await expect(host.link!(info(), access, { type: 'Commit', sha: 'aaaaaaaa' })).rejects.toThrow('no longer available');
});

test('diff links retain a deleted file and select the staged side', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    await fixtureGit('init', '-q');
    await writeFile(join(folder, 'a.md'), 'initial');
    await fixtureGit('add', 'a.md');
    await fixtureGit('commit', '-qm', 'Fixture commit');
    await unlink(join(folder, 'a.md'));
    hosts.gitStatus = async () => ({
        repo: true,
        root: folder,
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        base: null,
        mergeBase: null,
        files: [{ path: 'a.md', state: 'staged', status: 'D', added: 0, deleted: 1, binary: false }],
        truncated: false,
        live: false
    });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Diff', path: 'a.md' })).toMatchObject({
        state: 'chip',
        target: { type: 'Diff', path: join(folder, 'a.md') },
        cwd: folder,
        staged: true,
        relativePath: 'a.md'
    });
    await expect(host.link!(info(), access, { type: 'Diff', path: 'other.md' })).rejects.toThrow('no current diff');
});

test('commit and diff links resolve in a repository beside the agent’s own', async () => {
    const { writeFile } = await import('node:fs/promises');
    await fixtureGit('init', '-q');
    const nested = join(folder, 'lib');
    await mkdir(nested);
    const nestedGit = (...args: string[]) => fixtureGitIn(nested, ...args);
    await nestedGit('init', '-q');
    await writeFile(join(nested, 'b.md'), 'initial');
    await nestedGit('add', 'b.md');
    await nestedGit('commit', '-qm', 'Nested commit');
    const sha = await nestedGit('rev-parse', 'HEAD');
    await writeFile(join(nested, 'b.md'), 'changed');
    hosts.gitStatus = async (cwd) => ({
        repo: true,
        root: cwd,
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        base: null,
        mergeBase: null,
        files: cwd === nested ? [{ path: 'b.md', state: 'unstaged', status: 'M', added: 1, deleted: 1, binary: false }] : [],
        truncated: false,
        live: false
    });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    expect(await host.link!(info(), access, { type: 'Commit', sha })).toMatchObject({ state: 'chip', cwd: nested, label: 'Nested commit' });
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
    const base = await hosts.gitStatus(folder);
    reads = [];
    hosts.gitStatus = async () => ({ ...base, repo: true, branch: 'main', ahead: 2, files });
    const host = ruimteUiSources(hosts);
    const access = await host.capture(info());
    const source = host.sources['git.status']!;
    const status = source.result.parse(await source.read(info(), { repo: '.' }, new AbortController().signal, access));
    expect(status).toMatchObject({ branch: 'main', ahead: 2, counts: { staged: 667, unstaged: 1333, untracked: 0, conflicted: 0 }, truncated: true });
    expect((status as { files: unknown[] }).files).toHaveLength(50);
    expect(JSON.stringify(status).length).toBeLessThan(64 * 1024);
});
