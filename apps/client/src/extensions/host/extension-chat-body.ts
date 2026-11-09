import type { ComponentType } from 'react';

type ChatBodyComponent = ComponentType<{ id: string; focused: boolean }>;

export let ExtensionChatBody: ChatBodyComponent | null = null;

/* Handed over from `nodes`, which can import the chat body that this folder cannot. */
export function provideExtensionChatBody(chatBody: ChatBodyComponent): void {
    ExtensionChatBody = chatBody;
}
