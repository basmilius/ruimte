import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChatCreatePayload, type ProjectChatView } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { newInlineChat, removeInlineChat, showInlineChat, type InlineChatHost } from './inline-chat.ts';
import { ProjectStore } from './project-store.ts';

let root: string;
let folder: string;
let projectId: string;
let store: ProjectStore;
let started: ChatCreatePayload[];
let ended: string[];
let failing: boolean;
let worktrees: string[];

const host: InlineChatHost = {
    start: async (payload) => {
        if (failing) {
            throw new Error('the CLI will not start');
        }
        started.push(payload);
    },
    end: async (chatId) => {
        ended.push(chatId);
    },
    worktreePaths: async () => worktrees
};

async function chatViews(): Promise<ProjectChatView[]> {
    return (await store.read(projectId)).views.filter((view): view is ProjectChatView => view.kind === 'chat');
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-inline-')));
    folder = join(root, 'project');
    await mkdir(folder);
    store = new ProjectStore(join(root, 'home'), new FakeWatch());
    projectId = (await store.openProject({ folder })).summary.projectId;
    started = [];
    ended = [];
    failing = false;
    worktrees = [folder];
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('a new inline chat', () => {
    test('is a hidden chat view and a chat in the supervised mode, in the project folder', async () => {
        const { chatId, viewId } = await newInlineChat(store, { projectId, path: 'src/score.ts', provider: 'codex', model: 'gpt-x' }, host);

        expect(chatId).toBe(viewId);
        expect(await chatViews()).toEqual([
            expect.objectContaining({ id: viewId, hidden: true, node: { cwd: folder, provider: 'codex', runtimeMode: 'supervised' } })
        ]);
        expect(started).toEqual([{ chatId, provider: 'codex', cwd: folder, selection: { model: 'gpt-x', options: {} }, runtimeMode: 'supervised' }]);
    });

    test('is not in the sidebar, which an agent and the phone read', async () => {
        await store.mutate(projectId, (content) => ({
            content: { ...content, views: [...content.views, { kind: 'chat', id: 'chat-mine', name: 'Mine', node: { cwd: folder } }] },
            result: undefined
        }));
        await newInlineChat(store, { projectId, path: 'a.ts', provider: 'claude' }, host);

        const { projects } = await store.sidebar();

        expect(projects.find((entry) => entry.summary.projectId === projectId)?.views?.map((view) => view.id)).toEqual(['chat-mine']);
    });

    test('runs in the worktree a file of one is in', async () => {
        const worktree = join(root, 'worktrees', 'feature');
        worktrees = [folder, worktree];

        await newInlineChat(store, { projectId, path: join(worktree, 'src', 'a.ts'), provider: 'claude' }, host);

        expect(started[0]?.cwd).toBe(worktree);
        expect((await chatViews())[0]?.node.cwd).toBe(worktree);
    });

    test('refuses a file outside the project and its worktrees, and writes nothing', async () => {
        await expect(newInlineChat(store, { projectId, path: join(root, 'elsewhere', 'a.ts'), provider: 'claude' }, host)).rejects.toMatchObject({
            code: 'inline-path-outside'
        });
        expect(await chatViews()).toEqual([]);
    });

    test('takes its view back when the chat will not start', async () => {
        failing = true;

        await expect(newInlineChat(store, { projectId, path: 'a.ts', provider: 'claude' }, host)).rejects.toThrow('will not start');
        expect(await chatViews()).toEqual([]);
    });

    test('refuses a project the machine does not know', async () => {
        await expect(newInlineChat(store, { projectId: 'nope', path: 'a.ts', provider: 'claude' }, host)).rejects.toMatchObject({ code: 'project-not-found' });
    });
});

describe('showing and removing an inline chat', () => {
    test('showing lists it as a chat of its own', async () => {
        const { viewId } = await newInlineChat(store, { projectId, path: 'a.ts', provider: 'claude' }, host);

        await showInlineChat(store, { projectId, viewId });

        const [view] = await chatViews();
        expect(view?.id).toBe(viewId);
        expect(view && 'hidden' in view).toBe(false);
        // A listed chat is a person's conversation, so removing it is no longer this request's to do.
        await removeInlineChat(store, { projectId, viewId }, host);
        expect(ended).toEqual([]);
        expect(await chatViews()).toHaveLength(1);
    });

    test('removing ends the chat and takes its view away', async () => {
        const { viewId } = await newInlineChat(store, { projectId, path: 'a.ts', provider: 'claude' }, host);

        await removeInlineChat(store, { projectId, viewId }, host);

        expect(ended).toEqual([viewId]);
        expect(await chatViews()).toEqual([]);
        // Twice is as good as once: the card may be discarded again by a client that missed the answer.
        await removeInlineChat(store, { projectId, viewId }, host);
        expect(ended).toEqual([viewId]);
    });

    test('showing a chat that is gone says so', async () => {
        await expect(showInlineChat(store, { projectId, viewId: 'chat-gone' })).rejects.toMatchObject({ code: 'inline-chat-not-found' });
    });

    test('never removes a chat that is not hidden', async () => {
        await store.mutate(projectId, (content) => ({
            content: { ...content, views: [...content.views, { kind: 'chat', id: 'chat-mine', name: 'Mine', node: { cwd: folder } }] },
            result: undefined
        }));

        await removeInlineChat(store, { projectId, viewId: 'chat-mine' }, host);

        expect(ended).toEqual([]);
        expect(await chatViews()).toHaveLength(1);
    });
});
