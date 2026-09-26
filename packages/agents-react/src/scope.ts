import { createContext, useContext } from 'react';
import type { ChatClient } from './chat/chat-client';
import type { ChatTransport } from './transport';

/*
 * One host of chats, as everything under it sees it. An app with several hosts renders a scope per
 * host and every row the chat keeps names the scope it came from, so two hosts never paint each
 * other's threads.
 */
export interface ChatScope {
    /* Names this host in the stores that keep one row per host: its providers, accounts and usage. */
    readonly id: string;
    /* Where a chat's row is kept in the chats store. The app decides what a key looks like; the chat never builds one. */
    keyOf(chatId: string): string;
    readonly transport: ChatTransport;
    readonly chats: ChatClient;
}

export const ChatScopeContext = createContext<ChatScope | null>(null);

/* Throws outside a scope on purpose: a component that reads a chat has to know which host it runs on. */
export const useChatScope = (): ChatScope => {
    const scope = useContext(ChatScopeContext);
    if (scope === null) {
        throw new Error('This component reads a chat, so it has to be rendered inside a ChatScopeContext');
    }
    return scope;
};
