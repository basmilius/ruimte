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
