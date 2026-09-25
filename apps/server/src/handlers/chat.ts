import type {
    ChatContinueOnPayload,
    ChatContinueOnResult,
    ChatForkInfoPayload,
    ChatForkInfoResult,
    ChatForkPayload,
    ChatForkResult,
    ChatSummarizeResult
} from '@ruimte/contracts';
import { translate, type Dispatcher } from '../dispatcher.ts';
import { ChatError } from '../chat/errors.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { BeforeKill } from './session.ts';

export interface ChatForkHandlers {
    fork(payload: ChatForkPayload): Promise<ChatForkResult>;
    info(payload: ChatForkInfoPayload): Promise<ChatForkInfoResult>;
    summarize(chatId: string): Promise<ChatSummarizeResult>;
    continueOn(payload: ChatContinueOnPayload): Promise<ChatContinueOnResult>;
}

export const registerChatHandlers = (
    dispatcher: Dispatcher,
    manager: ChatManager,
    providers: ProviderRegistry,
    beforeKill?: BeforeKill,
    stopNode?: (nodeId: string, reason: string) => Promise<void>,
    forks?: ChatForkHandlers
): void => {
    dispatcher.register('provider.list', async () => ({ providers: await providers.list() }));

    dispatcher.register('chat.create', (payload) => translate(() => manager.create(payload)));

    dispatcher.register('chat.configure', (payload) => translate(() => manager.configure(payload)));

    // What a chat the daemon starts on its own is made with, while this socket is connected.
    dispatcher.register('chat.setPreferences', (payload, client) => {
        manager.composerPreferences.set(client.id, payload);
        return {};
    });

    dispatcher.register('chat.attach', (payload, client) =>
        translate(() => manager.attachWithBookmarks(payload.chatId, client.id, payload.historyLimit, payload.since))
    );

    dispatcher.register('chat.history', (payload) => translate(() => manager.history(payload.chatId, payload.cursor, payload.limit)));

    dispatcher.register('chat.subagent', (payload, client) => translate(() => manager.subagent(client.id, payload)));

    dispatcher.register('chat.stopSubagent', (payload) =>
        translate(async () => {
            await manager.stopSubagent(payload.chatId, payload.toolUseId, stopNode);
            return {};
        })
    );

    dispatcher.register('chat.stopTask', (payload) =>
        translate(async () => {
            await manager.stopTask(payload.chatId, payload.taskId);
            return {};
        })
    );

    dispatcher.register('chat.detach', (payload, client) =>
        translate(() => {
            manager.detach(payload.chatId, client.id);
            return {};
        })
    );

    dispatcher.register('chat.send', (payload) =>
        translate(() =>
            manager.send(payload.chatId, payload.text, { mentions: payload.mentions, skills: payload.skills, chats: payload.chats }, payload.attachments)
        )
    );

    dispatcher.register('chat.unqueue', (payload) => translate(() => ({ message: manager.unqueue(payload.chatId, payload.messageId) })));

    dispatcher.register('chat.sendNow', (payload) =>
        translate(() => {
            manager.sendNow(payload.chatId, payload.messageId);
            return {};
        })
    );

    dispatcher.register('skills.list', (payload) => translate(async () => ({ skills: await manager.skills(payload.chatId) })));

    dispatcher.register('chat.compact', (payload) =>
        translate(() => {
            manager.compact(payload.chatId);
            return {};
        })
    );

    dispatcher.register('chat.clear', (payload) =>
        translate(async () => {
            await manager.clear(payload.chatId, payload.force === true);
            return {};
        })
    );

    dispatcher.register('chat.turnDiff', (payload) => translate(async () => ({ diff: await manager.turnDiff(payload.chatId, payload.turnId) })));

    const forking = (): ChatForkHandlers => {
        if (!forks) {
            throw new ChatError('chat-unsupported', 'This machine does not fork chats');
        }
        return forks;
    };

    dispatcher.register('chat.fork', (payload) => translate(() => forking().fork(payload)));

    dispatcher.register('chat.forkInfo', (payload) => translate(() => forking().info(payload)));

    dispatcher.register('chat.summarize', (payload) => translate(() => forking().summarize(payload.chatId)));

    dispatcher.register('chat.continueOn', (payload) => translate(() => forking().continueOn(payload)));

    dispatcher.register('chat.cancel', (payload) =>
        translate(async () => {
            // Owed on disk before the turn stops, so a restart in between still ends the agents it opened.
            if (payload.subagents === true && manager.get(payload.chatId)) {
                await beforeKill?.(payload.chatId);
            }
            manager.cancel(payload.chatId, payload.subagents === true);
            return {};
        })
    );

    dispatcher.register('chat.approve', (payload) =>
        translate(() => {
            manager.approve(payload.chatId, payload.requestId, payload.decision, payload.message);
            return {};
        })
    );

    dispatcher.register('chat.answer', (payload) =>
        translate(() => {
            manager.answer(payload.chatId, payload.requestId, payload.answers);
            return {};
        })
    );

    dispatcher.register('chat.dismiss', (payload) =>
        translate(() => {
            manager.dismiss(payload.chatId, payload.itemId);
            return {};
        })
    );

    dispatcher.register('chat.addBookmark', (payload) =>
        translate(async () => ({ bookmarks: await manager.addBookmark(payload.chatId, payload.itemId, payload.name) }))
    );

    dispatcher.register('chat.renameBookmark', (payload) =>
        translate(async () => ({ bookmarks: await manager.renameBookmark(payload.chatId, payload.itemId, payload.name) }))
    );

    dispatcher.register('chat.removeBookmark', (payload) =>
        translate(async () => ({ bookmarks: await manager.removeBookmark(payload.chatId, payload.itemId) }))
    );

    dispatcher.register('chat.kill', (payload) =>
        translate(async () => {
            await beforeKill?.(payload.chatId);
            await manager.kill(payload.chatId);
            return {};
        })
    );

    dispatcher.register('chat.list', () => ({ chats: manager.list() }));
};
