import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { ChatError } from '../chat/errors.ts';
import type { ContextStore } from '../context/context-store.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof ChatError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerChatHandlers = (dispatcher: Dispatcher, manager: ChatManager, providers: ProviderRegistry, context: ContextStore): void => {
    dispatcher.register('provider.list', async () => ({ providers: await providers.list() }));

    dispatcher.register('context.set', (payload) => {
        context.set(payload.targetId, payload.sources);
        return {};
    });

    dispatcher.register('chat.create', (payload) => translate(() => manager.create(payload)));

    dispatcher.register('chat.configure', (payload) => translate(() => manager.configure(payload)));

    dispatcher.register('chat.attach', (payload, client) => translate(() => manager.attach(payload.chatId, client.id)));

    dispatcher.register('chat.detach', (payload, client) =>
        translate(() => {
            manager.detach(payload.chatId, client.id);
            return {};
        })
    );

    dispatcher.register('chat.send', (payload) =>
        translate(() => manager.send(payload.chatId, payload.text, { mentions: payload.mentions, skills: payload.skills, attachments: payload.attachments }))
    );

    dispatcher.register('chat.unqueue', (payload) =>
        translate(() => {
            manager.unqueue(payload.chatId, payload.messageId);
            return {};
        })
    );

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

    dispatcher.register('chat.turnDiff', (payload) => translate(async () => ({ diff: await manager.turnDiff(payload.chatId, payload.turnId) })));

    dispatcher.register('chat.cancel', (payload) =>
        translate(() => {
            manager.cancel(payload.chatId);
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

    dispatcher.register('chat.kill', (payload) =>
        translate(async () => {
            await manager.kill(payload.chatId);
            return {};
        })
    );

    dispatcher.register('chat.list', () => ({ chats: manager.list() }));
};
