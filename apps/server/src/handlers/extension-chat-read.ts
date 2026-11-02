import type { Dispatcher } from '../dispatcher.ts';

/* `chats.read` of an extension's client, on the reader `server/` asks, so a chat in a view of its own reads as well. */
export function registerExtensionChatRead(dispatcher: Pick<Dispatcher, 'register'>, read: (chatId: string) => Promise<string>): void {
    dispatcher.register('extension.chatRead', async ({ chatId }) => ({ text: await read(chatId) }));
}
