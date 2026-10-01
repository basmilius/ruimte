import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectChatView } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { initRepo } from '../git/test-repo.ts';
import { ProjectStore } from './project-store.ts';
import { newScratchChat, scratchFolderOf } from './scratch-project.ts';

let root: string;
let store: ProjectStore;

const isFolder = async (path: string): Promise<boolean> => (await stat(path).catch(() => null))?.isDirectory() ?? false;

const chatViews = async (projectId: string): Promise<ProjectChatView[]> =>
    (await store.read(projectId)).views.filter((view): view is ProjectChatView => view.kind === 'chat');

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-scratch-')));
    store = new ProjectStore(join(root, 'home'), new FakeWatch());
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('a new chat outside any project', () => {
    test('two at once make one project and a folder for each chat', async () => {
        const [first, second] = await Promise.all([newScratchChat(store, {}), newScratchChat(store, { provider: 'codex' })]);

        expect(first.summary.projectId).toBe(second.summary.projectId);
        expect(first.viewId).not.toBe(second.viewId);
        expect(first.summary.scratch).toBe(true);
        expect((await store.list()).filter((summary) => summary.scratch)).toHaveLength(1);
        const scratch = scratchFolderOf(store.home);
        expect((await readdir(scratch)).filter((name) => name.startsWith('chat-')).sort()).toEqual([first.viewId, second.viewId].sort());
        const views = await chatViews(first.summary.projectId);
        expect(views.map((view) => [view.id, view.node.cwd, view.node.provider])).toEqual(
            expect.arrayContaining([
                [first.viewId, join(scratch, first.viewId), undefined],
                [second.viewId, join(scratch, second.viewId), 'codex']
            ])
        );
    });

    test('a scratch folder someone deleted comes back under the same project', async () => {
        const before = await newScratchChat(store, {});
        await rm(scratchFolderOf(store.home), { recursive: true, force: true });

        const after = await newScratchChat(store, {});

        expect(after.summary.projectId).toBe(before.summary.projectId);
        expect(await isFolder(join(scratchFolderOf(store.home), after.viewId))).toBe(true);
        expect((await chatViews(after.summary.projectId)).map((view) => view.id)).toEqual([after.viewId]);
    });

    test('a home inside a git checkout is refused and makes nothing', async () => {
        const checkout = join(root, 'checkout');
        await initRepo(checkout, { 'README.md': 'hello\n' });
        const inside = new ProjectStore(join(checkout, 'home'), new FakeWatch());

        const refusal = await newScratchChat(inside, {}).catch((e: unknown) => e);

        expect(refusal).toMatchObject({ code: 'scratch-unavailable' });
        expect(await isFolder(scratchFolderOf(inside.home))).toBe(false);
        expect(await inside.list()).toEqual([]);
        inside.closeAll();
    });

    test('every other project has no scratch flag', async () => {
        await newScratchChat(store, {});
        const folder = join(root, 'repo');
        await store.openProject({ folder, createFolder: true });

        expect((await store.list()).map((summary) => [summary.name, summary.scratch])).toEqual([
            ['Chats', true],
            ['repo', undefined]
        ]);
    });
});
