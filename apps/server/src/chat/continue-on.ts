import type { ChatContinueOnPayload, ChatContinueOnResult, ChatForkPayload, ChatForkResult } from '@ruimte/contracts';
import type { ChatManager } from './chat-manager.ts';

export interface ContinueOnDeps {
    chats: Pick<ChatManager, 'limitedTurnFor' | 'continueInPlace' | 'continueInFork' | 'continuedInFork'>;
    fork(payload: ChatForkPayload): Promise<ChatForkResult>;
}

/*
 * Goes on after a turn that stopped on a limit under another account, only ever because a person
 * asked. An account that reads the chat's transcripts (Codex accounts over one home) takes the chat
 * over in place; any other gets a fork cut after the limited turn, with the conversation handed over.
 * The original's resume at the reset lapses either way, so the turn is never taken up twice; after a
 * fork the original never owes that turn a resume again, whatever switch a person turns on later.
 */
export const continueOn = async (deps: ContinueOnDeps, payload: ChatContinueOnPayload): Promise<ChatContinueOnResult> => {
    const { turnId, limit, inPlace } = await deps.chats.limitedTurnFor(payload.chatId, payload.account);
    if (inPlace) {
        deps.chats.continueInPlace(payload.chatId, payload.account);
        return { chatId: payload.chatId };
    }
    const fork = await deps.fork({ chatId: payload.chatId, turnId, account: payload.account });
    deps.chats.continuedInFork(payload.chatId, fork.info.account);
    await deps.chats.continueInFork(fork.info.chatId, limit);
    return { chatId: fork.info.chatId, fork };
};
