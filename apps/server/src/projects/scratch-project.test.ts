import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectChatView } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { initRepo } from '../git/test-repo.ts';
import { ProjectStore } from './project-store.ts';
import { dropEmptyMark, newScratchChat, reusableChat, scratchFolderOf } from './scratch-project.ts';

let root: string;
let store: ProjectStore;

async function isFolder(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function chatViews(projectId: string): Promise<ProjectChatView[]> {
    return (await store.read(projectId)).views.filter((view): view is ProjectChatView => view.kind === 'chat');
}

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
        const [first, second] = await Promise.all([newScratchChat(store, { provider: 'claude' }), newScratchChat(store, { provider: 'codex' })]);

        expect(first.summary.projectId).toBe(second.summary.projectId);
        expect(first.viewId).not.toBe(second.viewId);
        expect(first.summary.scratch).toBe(true);
        expect((await store.list()).filter((summary) => summary.scratch)).toHaveLength(1);
        const scratch = scratchFolderOf(store.home);
        expect((await readdir(scratch)).filter((name) => name.startsWith('chat-')).sort()).toEqual([first.viewId, second.viewId].sort());
        const views = await chatViews(first.summary.projectId);
        expect(views.map((view) => [view.id, view.node.cwd, view.node.provider])).toEqual(
            expect.arrayContaining([
                [first.viewId, join(scratch, first.viewId), 'claude'],
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

    test('a new chat shows the one nobody wrote in yet, to two clients asking at once too', async () => {
        const first = await newScratchChat(store, {});
        const [second, third] = await Promise.all([newScratchChat(store, {}), newScratchChat(store, {})]);

        expect([second.viewId, third.viewId]).toEqual([first.viewId, first.viewId]);
        expect((await chatViews(first.summary.projectId)).map((view) => [view.id, view.empty])).toEqual([[first.viewId, true]]);
    });

    test('a chat that was written in is listed and a new one is made above it', async () => {
        const first = await newScratchChat(store, {});

        const second = await newScratchChat(store, {}, (chatId) => Promise.resolve(chatId === first.viewId));

        expect(second.viewId).not.toBe(first.viewId);
        expect((await chatViews(first.summary.projectId)).map((view) => [view.id, view.empty])).toEqual([
            [second.viewId, true],
            [first.viewId, undefined]
        ]);
    });

    test('the first message lists the chat, and drops nothing anywhere else', async () => {
        const first = await newScratchChat(store, {});

        await dropEmptyMark(store, first.viewId);
        await dropEmptyMark(store, 'chat-elsewhere');

        expect((await chatViews(first.summary.projectId)).map((view) => view.empty)).toEqual([undefined]);
        expect((await newScratchChat(store, {})).viewId).not.toBe(first.viewId);
    });
});

describe('the empty chat a new chat reuses', () => {
    const view = (id: string, node: ProjectChatView['node'], empty?: boolean): ProjectChatView => ({
        kind: 'chat',
        id,
        name: 'New chat',
        node,
        ...(empty ? { empty } : {})
    });

    test('is one nobody wrote in, of the CLI and account asked for when the request names them', () => {
        const views = [view('written', {}), view('codex', { provider: 'codex' }, true), view('claude', { provider: 'claude', account: 'work' }, true)];

        expect(reusableChat(views, {})?.id).toBe('codex');
        expect(reusableChat(views, { provider: 'claude' })?.id).toBe('claude');
        expect(reusableChat(views, { provider: 'claude', account: 'home' })).toBeNull();
        expect(reusableChat([view('written', {})], {})).toBeNull();
    });
});
