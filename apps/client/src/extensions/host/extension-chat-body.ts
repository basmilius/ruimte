import type { ComponentType } from 'react';

type ChatBodyComponent = ComponentType<{ id: string; focused: boolean }>;

/* The chat body an extension's `Chat` draws, once `nodes/extension-chat.ts` has handed it over. */
export let ExtensionChatBody: ChatBodyComponent | null = null;

/* Handed over from `nodes`, which can import the chat body that this folder cannot. */
export function provideExtensionChatBody(chatBody: ChatBodyComponent): void {
    ExtensionChatBody = chatBody;
}
