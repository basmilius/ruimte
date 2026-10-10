import { useChats } from '@adecore/agents-react/state/chats';
import { draftFiles } from '@/language/project-files';
import { focusChat } from '@/plan/plan-actions';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { chatClientFor } from '@/transport/connections';
import { TransportError } from '@/transport/transport';
import { forgetInlineEdit, saveInlineEdit } from './inline-edit-record';
import type { InlineEditDeps } from './inline-edit-session';

function notConnected(): TransportError {
    return new TransportError('not-connected', 'The machine is not connected.');
}

/* The machine this edit runs on, or the reason it cannot: a card never starts a chat on a machine it lost. */
function transportOf(endpointId: string) {
    const transport = transportFor(endpointId);
    if (transport === null || transport.status !== 'open') {
        throw notConnected();
    }
    return transport;
}

function clientOf(endpointId: string) {
    const client = chatClientFor(endpointId);
    if (client === null) {
        throw notConnected();
    }
    return client;
}

/* What an inline edit uses of the app, for one machine. */
export function inlineEditDeps(endpointId: string): InlineEditDeps {
    const keyOf = (chatId: string): string => endpointKey(endpointId, chatId);
    const files = () => draftFiles(endpointId, transportOf(endpointId));
    return {
        now: () => Date.now(),
        newChat: (payload) => transportOf(endpointId).request('project.newInlineChat', payload),
        openChat: async (chatId, provider) => {
            await clientOf(endpointId).open(chatId, { provider, runtimeMode: 'supervised' });
        },
        readChat: (chatId) => useChats.getState().byKey[keyOf(chatId)],
        watchChat: (chatId, listener) => {
            const key = keyOf(chatId);
            return useChats.subscribe((state, previous) => {
                if (state.byKey[key] !== previous.byKey[key]) {
                    listener(state.byKey[key]);
                }
            });
        },
        stopChat: async (chatId) => {
            await transportOf(endpointId).request('chat.cancel', { chatId });
        },
        send: async (chatId, text, mentions) => (await clientOf(endpointId).send(chatId, text, { mentions })).turnId ?? null,
        releaseChat: (chatId) => {
            void clientOf(endpointId).detach(chatId);
            useChats.getState().forget(keyOf(chatId));
        },
        removeChat: async (projectId, viewId) => {
            await transportOf(endpointId).request('project.removeInlineChat', { projectId, viewId });
        },
        showChat: async (projectId, viewId) => {
            await transportOf(endpointId).request('project.showInlineChat', { projectId, viewId });
        },
        focusChat,
        viewExists: (_projectId, viewId) => useDocument.getState().views.some((view) => view.id === viewId),
        readFile: (path) => files().read(path),
        stageFile: (path, disk, text) => files().stage([{ path, disk, text }]),
        saveRecord: (record) => saveInlineEdit(endpointId, record),
        forgetRecord: (path, chatId) => forgetInlineEdit(endpointId, path, chatId),
        notify: (toast) => {
            useToasts.getState().show({ ...toast, persist: toast.kind === 'success', ...(toast.action === undefined ? {} : { action: toast.action }) });
        }
    };
}
