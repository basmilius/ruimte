import i18next from 'i18next';
import { chatHost, type ChatActions } from '../host';
import { useChatScope, type ChatScope } from '../scope';
import { ChatTransportError, type ChatTransport } from '../transport';

/* Every action as the request a chat host answers, for an app that runs them through nothing of its own. */
export const transportActions = (transport: ChatTransport): ChatActions => ({
    clear: async (chatId, force) => {
        await transport.request('chat.clear', { chatId, ...(force ? { force: true } : {}) });
    },
    stopTurn: async (chatId, subagents) => {
        await transport.request('chat.cancel', { chatId, ...(subagents ? { subagents: true } : {}) });
    },
    unqueue: async (chatId, messageId) => {
        const { message } = await transport.request('chat.unqueue', { chatId, messageId });
        // A host answers without the message once it went out, which is what the composer tells a person.
        if (message === undefined) {
            throw new ChatTransportError('request-not-found', i18next.t('agent-chat:composer.queue.alreadySent'));
        }
    },
    sendNow: async (chatId, messageId) => {
        await transport.request('chat.sendNow', { chatId, messageId });
    },
    compact: async (chatId) => {
        await transport.request('chat.compact', { chatId });
    },
    configure: async (chatId, patch) => {
        await transport.request('chat.configure', { chatId, ...patch });
    },
    continueOn: async (chatId, account) => {
        await transport.request('chat.continueOn', { chatId, account });
    },
    turnDiff: async (chatId, turnId) => (await transport.request('chat.turnDiff', { chatId, turnId })).diff,
    stopSubagent: async (chatId, toolUseId) => {
        await transport.request('chat.stopSubagent', { chatId, toolUseId });
    },
    stopTask: async (chatId, taskId) => {
        await transport.request('chat.stopTask', { chatId, taskId });
    },
    approve: async (chatId, requestId, decision, message) => {
        await transport.request('chat.approve', { chatId, requestId, decision, ...(message === undefined ? {} : { message }) });
    },
    answer: async (chatId, requestId, answers) => {
        await transport.request('chat.answer', { chatId, requestId, answers });
    },
    dismiss: async (chatId, itemId) => {
        await transport.request('chat.dismiss', { chatId, itemId });
    }
});

const byTransport = new WeakMap<ChatTransport, ChatActions>();

/* The app's own actions when it has them, and the requests of this scope's host otherwise. */
export const actionsOf = (scope: ChatScope): ChatActions => {
    const own = chatHost().actions;
    if (own !== null) {
        return own;
    }
    const { transport } = scope;
    let actions = byTransport.get(transport);
    if (actions === undefined) {
        actions = transportActions(transport);
        byTransport.set(transport, actions);
    }
    return actions;
};

export const useChatActions = (): ChatActions => actionsOf(useChatScope());
