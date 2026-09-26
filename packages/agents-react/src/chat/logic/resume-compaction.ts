import type { ChatInfo, ChatItem, ProviderCapabilities } from '@ruimte/agent-contracts';

/*
 * An absolute count, not a share of the window: reading a thread again costs per token, so 100k in a
 * window of 1M is as expensive as 100k in a window of 200k.
 */
export const RESUME_COMPACTION_TOKENS = 100_000;

/* The longest prompt cache Claude keeps is an hour, so past this the whole thread is read again anyway. */
export const RESUME_COMPACTION_IDLE_MS = 70 * 60_000;

export interface ResumeCompactionOffer {
    /* The turn the offer is about, and the key "Keep full history" is remembered under. */
    turnId: string;
    tokens: number;
}

const lastTurn = (items: readonly ChatItem[]): Extract<ChatItem, { kind: 'turn' }> | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'turn') {
            return item;
        }
    }
    return null;
};

/*
 * Whether to offer compacting before the next message. The caller passes `now`, so this stays pure
 * and the test needs no clock.
 */
export const resumeCompactionOffer = ({
    info,
    compaction,
    items,
    dismissedTurnId,
    now
}: {
    info: ChatInfo;
    /* Absent until the host answered `provider.list`. */
    compaction: ProviderCapabilities['compaction'] | undefined;
    items: readonly ChatItem[];
    dismissedTurnId: string | null;
    now: number;
}): ResumeCompactionOffer | null => {
    if (compaction === undefined || compaction === 'none') {
        return null;
    }
    if (info.activeTurnId !== null || (info.queue ?? []).length > 0) {
        return null;
    }
    if (info.usage.contextTokens < RESUME_COMPACTION_TOKENS) {
        return null;
    }
    const turn = lastTurn(items);
    if (turn === null || turn.endedAt === null || turn.id === dismissedTurnId) {
        return null;
    }
    if (now - turn.endedAt < RESUME_COMPACTION_IDLE_MS) {
        return null;
    }
    /*
     * `contextTokens` keeps the old number until the next request, so without this the offer would
     * come straight back after a compaction. A native compaction is a turn without a message of the
     * person, which is why this looks at the turn and not at the last thing that was said.
     */
    if (items.some((item) => item.kind === 'compaction' && item.turnId === turn.id)) {
        return null;
    }
    return { turnId: turn.id, tokens: info.usage.contextTokens };
};
