import type { ChatContinueOnPayload, ChatContinueOnResult, ChatForkPayload, ChatForkResult, ChatTurnLimit } from '@ruimte/contracts';
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

/*
 * The turn that takes a limited one up under another account a person picked: in the chat itself, or
 * in the fork that got its conversation handed over, whose own note already says where it came from.
 */
export const continueOnWake = (kind: ChatTurnLimit['kind'], account: string, forked: boolean): { text: string; label: string; note?: string } => {
    const reason = kind === 'usage' ? 'stopped on a usage limit' : 'stopped because the model was overloaded';
    const label = `Continued on ${account}`;
    if (forked) {
        return { text: `The last turn of the conversation you took over ${reason}. Continue where it left off.`, label };
    }
    return {
        text: `Your previous turn ${reason}. You now run under another account; continue where you left off.`,
        label,
        note: `Continued under the account '${account}' after the previous turn ${reason}`
    };
};

/* What the original of a fork that went on after its limited turn says under that turn. */
export const continuedInForkNote = (account: string): string => `Continued under the account '${account}' in a fork`;
