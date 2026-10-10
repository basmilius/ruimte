import { resolve } from 'node:path';
import type {
    ChatCreatePayload,
    ProjectChatView,
    ProjectInlineChatTargetPayload,
    ProjectNewInlineChatPayload,
    ProjectNewInlineChatResult
} from '@ruimte/contracts';
import { isHiddenChatView } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';
import type { ProjectStore } from './project-store.ts';
import { newChatId } from './scratch-project.ts';

export class InlineChatError extends CodedError<'project-not-found' | 'inline-path-outside' | 'inline-chat-not-found'> {}

/* What the daemon's chats and git give a hidden chat, so a test can stand in for both. */
export interface InlineChatHost {
    /* Makes the chat the view stands for, which no client has opened. */
    start(payload: ChatCreatePayload): Promise<unknown>;
    /* Ends the chat's CLI and removes its record. */
    end(chatId: string): Promise<void>;
    /* The checkouts of the repository the folder is in, the folder's own first. */
    worktreePaths(folder: string): Promise<string[]>;
}

const INLINE_CHAT_NAME = 'Inline edit';

/*
 * The folder the agent works in: the project's, or the checkout of the repository the file is in when
 * that is a worktree, so a file of a worktree is changed there and not in the checkout beside it.
 */
async function workingFolderOf(folder: string, path: string, host: InlineChatHost): Promise<string> {
    const file = resolve(folder, path);
    if (isInside(folder, file)) {
        return folder;
    }
    const worktree = (await host.worktreePaths(folder)).find((candidate) => isInside(candidate, file));
    if (worktree === undefined) {
        throw new InlineChatError('inline-path-outside', `${file} is outside ${folder} and the worktrees of its repository`);
    }
    return worktree;
}

/*
 * A chat for an edit of the selected lines of one file: a hidden chat view in the project's private
 * file and the chat itself, in the mode that asks before it changes a file. The view lands first so the
 * chat can tell it is an inline one; a chat that will not start takes its view back.
 */
export async function newInlineChat(store: ProjectStore, payload: ProjectNewInlineChatPayload, host: InlineChatHost): Promise<ProjectNewInlineChatResult> {
    const folder = store.index.folderOf(payload.projectId);
    if (folder === null) {
        throw new InlineChatError('project-not-found', `No project ${payload.projectId}`);
    }
    const cwd = await workingFolderOf(folder, payload.path, host);
    const id = newChatId();
    const view: ProjectChatView = {
        kind: 'chat',
        id,
        name: INLINE_CHAT_NAME,
        node: {
            cwd,
            provider: payload.provider,
            ...(payload.account === undefined ? {} : { account: payload.account }),
            runtimeMode: 'supervised'
        },
        hidden: true
    };
    await store.mutate(payload.projectId, (content) => ({ content: { ...content, views: [...content.views, view] }, result: undefined }));
    try {
        await host.start({
            chatId: id,
            provider: payload.provider,
            ...(payload.account === undefined ? {} : { account: payload.account }),
            cwd,
            ...(payload.model === undefined ? {} : { selection: { model: payload.model, options: {} } }),
            runtimeMode: 'supervised'
        });
    } catch (e) {
        await dropView(store, payload.projectId, id);
        throw e;
    }
    return { chatId: id, viewId: id };
}

async function dropView(store: ProjectStore, projectId: string, viewId: string): Promise<void> {
    await store.mutate(projectId, (content) =>
        content.views.some((view) => view.id === viewId)
            ? { content: { ...content, views: content.views.filter((view) => view.id !== viewId) }, result: undefined }
            : { content: null, result: undefined }
    );
}

function hiddenViewOf(store: ProjectStore, payload: ProjectInlineChatTargetPayload): ProjectChatView | null {
    const view = store.index.viewsOf(payload.projectId)?.find((candidate) => candidate.id === payload.viewId);
    return view !== undefined && isHiddenChatView(view) ? view : null;
}

/* Lists the chat of an inline edit as a chat of its own, which is what Open as chat does, so it stays after the card is gone. */
export async function showInlineChat(store: ProjectStore, payload: ProjectInlineChatTargetPayload): Promise<void> {
    if (hiddenViewOf(store, payload) === null) {
        if (store.index.viewsOf(payload.projectId)?.some((view) => view.id === payload.viewId)) {
            return;
        }
        throw new InlineChatError('inline-chat-not-found', `No inline chat ${payload.viewId} in ${payload.projectId}`);
    }
    await store.mutate(payload.projectId, (content) => ({
        content: {
            ...content,
            views: content.views.map((view) => {
                if (view.id !== payload.viewId || !isHiddenChatView(view)) {
                    return view;
                }
                const { hidden: _hidden, ...shown } = view;
                return shown;
            })
        },
        result: undefined
    }));
}

/*
 * Takes an inline chat away: its CLI and record first, then its view, the order a view delete follows.
 * A chat that is listed is a person's conversation by now, so only a hidden view is ever removed.
 */
export async function removeInlineChat(store: ProjectStore, payload: ProjectInlineChatTargetPayload, host: InlineChatHost): Promise<void> {
    if (hiddenViewOf(store, payload) === null) {
        return;
    }
    await host.end(payload.viewId);
    await dropView(store, payload.projectId, payload.viewId);
}
