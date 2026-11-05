import { resolveStoredPath } from '@ruimte/contracts';
import i18next from 'i18next';
import { openInSystemBrowser } from '@/desktop/bridge';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { nameOf } from './status-view';

/* Type 1 and 2 of LSP's `MessageType` are the error and the warning. */
const MOST_SEVERE_TYPE = 2;

/*
 * What a language server asks of a person: a message, a question with answers, a document to show. They
 * never go through the shared `onServerMessage` or `onShowDocument` of the service, which would open a
 * server's address without a press. A message comes to every client that holds the project, a document only
 * to the one whose command the server was running for.
 */
export function watchServerPrompts(
    transport: Transport,
    projectId: string,
    folder: string,
    openFile: (folder: string, path: string, line: number) => void
): () => void {
    const questions = new Map<string, () => void>();

    const answer = (messageId: string, action: string | null): void => {
        if (machineAnswers(transport.connection, 'language.messageAnswer')) {
            void transport.request('language.messageAnswer', { projectId, messageId, action }).catch(() => undefined);
        }
    };

    const offMessage = transport.on('language.message', (event) => {
        if (event.projectId !== projectId) {
            return;
        }

        const name = nameOf(event.title);

        if (event.actions === undefined) {
            useToasts.getState().show({
                id: `language-note:${projectId}:${event.server}:${event.message}`,
                kind: 'error',
                title: event.message,
                description: i18next.t('panels:language.message.from', { name })
            });
            return;
        }

        const id = `language-message:${projectId}:${event.messageId}`;
        let answered = false;
        const reply = (action: string | null): void => {
            if (answered) {
                return;
            }
            answered = true;
            questions.delete(event.messageId);
            answer(event.messageId, action);
            useToasts.getState().dismiss(id);
        };

        questions.set(event.messageId, () => {
            answered = true;
            questions.delete(event.messageId);
            useToasts.getState().dismiss(id);
        });
        useToasts.getState().show({
            id,
            kind: event.type <= MOST_SEVERE_TYPE ? 'error' : 'success',
            persist: true,
            title: event.message,
            description: i18next.t('panels:language.message.from', { name }),
            actions: event.actions.map((action) => ({ label: action, run: () => reply(action) })),
            onClose: () => reply(null)
        });
    });

    const offClosed = transport.on('language.messageClosed', (event) => {
        if (event.projectId === projectId) {
            questions.get(event.messageId)?.();
        }
    });

    const offShow = transport.on('language.show', (event) => {
        if (event.projectId !== projectId) {
            return;
        }

        if (event.path !== undefined) {
            const path = resolveStoredPath(folder, event.path);

            if (path !== null) {
                openFile(folder, path, (event.selection?.start.line ?? 0) + 1);
            }
            return;
        }

        const address = webAddressOf(event.url);

        if (address === null) {
            return;
        }

        useToasts.getState().show({
            id: `language-show:${projectId}:${address}`,
            kind: 'success',
            persist: true,
            title: i18next.t('panels:language.show.title', { name: nameOf(event.title) }),
            description: address,
            action: { label: i18next.t('panels:language.show.open'), run: () => openInSystemBrowser(address) }
        });
    });

    return () => {
        offMessage();
        offClosed();
        offShow();
    };
}

/* The daemon checks this too; an address that is no web page is not offered to a person to open. */
function webAddressOf(url: string | undefined): string | null {
    if (url === undefined) {
        return null;
    }

    try {
        const { protocol } = new URL(url);

        return protocol === 'http:' || protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}
