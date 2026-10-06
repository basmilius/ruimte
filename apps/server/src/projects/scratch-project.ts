import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isEmptyChatView, type ProjectChatView, type ProjectNewChatPayload, type ProjectNewChatResult, type ProjectView } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { git } from '../git/run.ts';
import type { ProjectStore } from './project-store.ts';

export class ScratchError extends CodedError<'scratch-unavailable'> {}

const SCRATCH_NAME = 'Chats';

// Until its first turn renames it, the way any chat view takes the name of what it was asked.
const NEW_CHAT_NAME = 'New chat';

export function scratchFolderOf(home: string): string {
    return join(resolve(home), 'scratch');
}

function newChatId(): string {
    return `chat-${randomBytes(6).toString('hex')}`;
}

/* Whether a person wrote in a chat yet, as its thread says; a chat this daemon has no thread of never had a message. */
export type ChatWritten = (chatId: string) => Promise<boolean>;

function notWritten(): Promise<boolean> {
    return Promise.resolve(false);
}

function withoutEmptyMark(view: ProjectView): ProjectView {
    if (!isEmptyChatView(view)) {
        return view;
    }
    const { empty: _empty, ...rest } = view;
    return rest;
}

/* The empty chat a new chat goes to instead of making another, of the CLI and account it asks for when it names one. */
export function reusableChat(views: readonly ProjectView[], payload: ProjectNewChatPayload): ProjectChatView | null {
    return (
        views
            .filter(isEmptyChatView)
            .find(
                (view) =>
                    (payload.provider === undefined || view.node.provider === payload.provider) &&
                    (payload.account === undefined || view.node.account === payload.account)
            ) ?? null
    );
}

/*
 * A chat outside any project. It is a chat view in the machine's scratch project, which the daemon
 * makes the first time one is asked for, and it works in a folder of its own under it, named after
 * the chat. The folder is claimed before the view lands, so a client that mounts the view finds it.
 * A chat nobody wrote in yet is hidden from the list, so that one is shown again rather than another
 * made beside it, and every client asking gets the same one.
 */
export async function newScratchChat(store: ProjectStore, payload: ProjectNewChatPayload, written: ChatWritten = notWritten): Promise<ProjectNewChatResult> {
    await mkdir(store.home, { recursive: true, mode: 0o700 });
    /* A scratch project inside a checkout would put every chat's folder in someone's repository,
       and its project files in their commits. */
    if ((await git(['rev-parse', '--show-toplevel'], store.home)) !== null) {
        throw new ScratchError('scratch-unavailable', `${store.home} is inside a git checkout`);
    }
    const summary = await store.ensureProject(store.scratchFolder, { name: SCRATCH_NAME, icon: { kind: 'lucide', value: 'messages-square' } });
    // Read outside the lock: loading a chat's thread must never wait on a write of this project.
    const marked = (await store.read(summary.projectId)).views.filter(isEmptyChatView);
    const spoken = new Set<string>();
    for (const view of marked) {
        if (await written(view.id)) {
            spoken.add(view.id);
        }
    }
    const viewId = await store.mutate(summary.projectId, async (content) => {
        // A mark the first message did not take away, such as one written just before the daemon went down.
        const views = content.views.map((view) => (spoken.has(view.id) ? withoutEmptyMark(view) : view));
        const reused = reusableChat(views, payload);
        if (reused !== null) {
            return { content: spoken.size > 0 ? { ...content, views } : null, result: reused.id };
        }
        const id = newChatId();
        // Without `recursive`, so a folder that is already there is an error rather than a second chat in it.
        await mkdir(join(store.scratchFolder, id));
        const view: ProjectChatView = {
            kind: 'chat',
            id,
            name: NEW_CHAT_NAME,
            node: {
                cwd: join(store.scratchFolder, id),
                ...(payload.provider === undefined ? {} : { provider: payload.provider }),
                ...(payload.account === undefined ? {} : { account: payload.account })
            },
            empty: true
        };
        // On top, so the list reads newest first.
        return { content: { ...content, views: [view, ...views] }, result: id };
    });
    return { summary, viewId };
}

/* Lists a chat of the Chats project once a person wrote in it. Nothing for any other chat. */
export async function dropEmptyMark(store: ProjectStore, chatId: string): Promise<void> {
    const place = store.index.locate(chatId);
    if (place === null || place.canvasId !== null) {
        return;
    }
    if (!store.index.viewsOf(place.projectId)?.some((view) => view.id === chatId && isEmptyChatView(view))) {
        return;
    }
    await store.mutate(place.projectId, (content) =>
        content.views.some((view) => view.id === chatId && isEmptyChatView(view))
            ? { content: { ...content, views: content.views.map((view) => (view.id === chatId ? withoutEmptyMark(view) : view)) }, result: undefined }
            : { content: null, result: undefined }
    );
}
