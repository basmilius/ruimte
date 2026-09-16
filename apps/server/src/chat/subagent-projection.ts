import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { ThreadProjector } from './projector.ts';
import { ChatThread } from './thread.ts';

// A subagent's conversation has no turns of its own; the projector is kept inside this one so it never opens any.
const READING_TURN = 'subagent-reading';

/* The info a thread needs to exist. Nothing reads it: a subagent's conversation is only ever its items. */
const readingInfo = (): ChatInfo => ({
    chatId: 'subagent',
    provider: 'claude',
    cwd: '',
    agentSessionId: null,
    model: null,
    selection: { model: '', options: {} },
    runtimeMode: 'full-access',
    status: 'running',
    running: true,
    activeTurnId: READING_TURN,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: 0, costUsd: 0, turns: 0 },
    createdAt: 0
});

/* A thread and the projector that writes it, for a conversation read back rather than streamed. */
export const readingThread = (providerName: string, now: () => number): { thread: ChatThread; projector: ThreadProjector } => {
    const thread = new ChatThread(readingInfo());
    return { thread, projector: new ThreadProjector(thread, { providerName, now }) };
};

/*
 * An item as a reader of a finished record sees it: nothing streams any more and nothing belongs to a
 * turn, so the timeline draws the whole conversation flat instead of folding it behind a turn it never had.
 */
export const settledReading = (item: ChatItem): ChatItem => {
    if (item.kind === 'assistant') {
        return { ...item, turnId: null, streaming: false };
    }
    if (item.kind === 'thinking') {
        return { ...item, turnId: null, streaming: false, endedAt: item.endedAt ?? item.createdAt };
    }
    return { ...item, turnId: null };
};
