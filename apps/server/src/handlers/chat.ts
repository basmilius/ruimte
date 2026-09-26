import type {
    ChatContinueOnPayload,
    ChatContinueOnResult,
    ChatForkInfoPayload,
    ChatForkInfoResult,
    ChatForkPayload,
    ChatForkResult,
    ChatSummarizeResult
} from '@ruimte/contracts';
import { chatHandlers } from '@ruimte/agents/host/handlers';
import { translate, type Dispatcher } from '../dispatcher.ts';
import { ChatError } from '../chat/errors.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { registerAgentHandlers } from './agent.ts';
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
    // What the daemon answers differently from a host of chats alone: a task's row stops its node, a stop or a
    // removal first owes the end of the agents a chat opened, and a fork lands on the canvas.
    const {
        'chat.stopSubagent': _stopSubagent,
        'chat.cancel': _cancel,
        'chat.kill': _kill,
        'chat.fork': _fork,
        'chat.forkInfo': _forkInfo,
        'chat.summarize': _summarize,
        'chat.continueOn': _continueOn,
        ...shared
    } = chatHandlers(manager, providers);
    registerAgentHandlers(dispatcher, shared);

    dispatcher.register('chat.stopSubagent', (payload) =>
        translate(async () => {
            await manager.stopSubagent(payload.chatId, payload.toolUseId, stopNode);
            return {};
        })
    );

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

    dispatcher.register('chat.kill', (payload) =>
        translate(async () => {
            await beforeKill?.(payload.chatId);
            await manager.kill(payload.chatId);
            return {};
        })
    );
};
