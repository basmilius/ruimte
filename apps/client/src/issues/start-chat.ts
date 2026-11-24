import { useChats } from '@adecore/agents-react/state';
import type { AgentKind, HostIssuePromptResult, HostRef } from '@ruimte/contracts';
import i18next from 'i18next';
import { perform } from '@/action-port/perform';
import { createNodeAction, createViewAction } from '@/action-port/person-actions';
import { projectClient } from '@/project/index';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport-api/transport';
import { createWorktreeChat } from '@/worktrees/worktree-chat';

/* A worktree made for the chat, and the CLI picked beside its branch. */
interface ChatPlace {
    cwd: string;
    provider: AgentKind;
}

interface IssueChat {
    transport: Transport;
    endpointId: string;
    projectId: string;
    ref: HostRef;
    opening: HostIssuePromptResult;
    /* Absent starts the chat in the project folder, on the CLI a new chat opens with. */
    place?: ChatPlace;
}

/* As New Chat makes one: a node on the canvas on screen, and a chat view of its own from any other view. */
function createChat(title: string): Promise<string | null> {
    return hasActiveCanvas(useDocument.getState()) ? createNodeAction('chat', { title }) : createViewAction('chat', { name: title });
}

/* A chat answers a message only once its body opened it on the machine, which is a moment after its node is made. */
function sendOnceOpen(endpointId: string, chatId: string, opening: HostIssuePromptResult): void {
    const key = endpointKey(endpointId, chatId);
    const isOpen = (): boolean => useChats.getState().byKey[key] !== undefined;

    const send = (): void => {
        perform('chat.send', { chatId, prompt: opening.prompt }).catch(() => {
            useToasts.getState().show({
                id: `issue-chat:${key}`,
                kind: 'error',
                title: i18next.t('issues:start.notSentTitle'),
                description: i18next.t('issues:start.notSent', { title: opening.title })
            });
        });
    };

    if (isOpen()) {
        send();

        return;
    }

    const off = useChats.subscribe(() => {
        if (isOpen()) {
            off();
            send();
        }
    });
}

/*
 * Starts a chat on an issue the way a person starts any chat, links the two and sends what the machine
 * worded as its first message. Throws when the chat or the link could not be made; resolves the chat's id.
 */
export async function startIssueChat({ transport, endpointId, projectId, ref, opening, place }: IssueChat): Promise<string> {
    const chatId = place === undefined ? await createChat(opening.title) : await createWorktreeChat({ ...place, title: opening.title });

    if (chatId === null) {
        throw new Error(i18next.t('issues:start.notMade'));
    }

    // The machine links only a chat its project file holds, so the new node is saved before the link is asked.
    await projectClient.flush();
    await transport.request('host.link', { projectId, chatId, ref });
    sendOnceOpen(endpointId, chatId, opening);

    return chatId;
}
