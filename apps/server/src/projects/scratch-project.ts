import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectChatView, ProjectNewChatPayload, ProjectNewChatResult } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import { git } from '../git/run.ts';
import type { ProjectStore } from './project-store.ts';

export class ScratchError extends CodedError<'scratch-unavailable'> {}

const SCRATCH_NAME = 'Chats';

// Until its first turn renames it, the way any chat view takes the name of what it was asked.
const NEW_CHAT_NAME = 'New chat';

export const scratchFolderOf = (home: string): string => join(resolve(home), 'scratch');

const newChatId = (): string => `chat-${randomBytes(6).toString('hex')}`;

/*
 * A chat outside any project. It is a chat view in the machine's scratch project, which the daemon
 * makes the first time one is asked for, and it works in a folder of its own under it, named after
 * the chat. The folder is claimed before the view lands, so a client that mounts the view finds it.
 */
export const newScratchChat = async (store: ProjectStore, payload: ProjectNewChatPayload): Promise<ProjectNewChatResult> => {
    await mkdir(store.home, { recursive: true, mode: 0o700 });
    /* A scratch project inside a checkout would put every chat's folder in someone's repository,
       and its project files in their commits. */
    if ((await git(['rev-parse', '--show-toplevel'], store.home)) !== null) {
        throw new ScratchError('scratch-unavailable', `${store.home} is inside a git checkout`);
    }
    const summary = await store.ensureProject(store.scratchFolder, { name: SCRATCH_NAME, icon: { kind: 'lucide', value: 'messages-square' } });
    const viewId = newChatId();
    const cwd = join(store.scratchFolder, viewId);
    // Without `recursive`, so a folder that is already there is an error rather than a second chat in it.
    await mkdir(cwd);
    const view: ProjectChatView = {
        kind: 'chat',
        id: viewId,
        name: NEW_CHAT_NAME,
        node: {
            cwd,
            ...(payload.provider === undefined ? {} : { provider: payload.provider }),
            ...(payload.account === undefined ? {} : { account: payload.account })
        }
    };
    await store.mutate(summary.projectId, (content) => ({ content: { ...content, views: [...content.views, view] }, result: undefined }));
    return { summary, viewId };
};
