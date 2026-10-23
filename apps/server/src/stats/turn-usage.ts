import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { countLimit, countTurn, countUsage, recordFirstToken } from './usage-stats.ts';

type TurnItem = Extract<ChatItem, { kind: 'turn' }>;

/*
 * What a chat's turns count, from the items its thread broadcasts: a turn that opens, once, by provider, model family
 * and mode, and the wait until its first words; a turn that ended on a usage limit, once; and the first turn after
 * such a limit as the work taken up again, by the clock or by a person. Plan mode is Claude's permission mode beside
 * the runtime mode. Only ever per chat in memory, so a restart counts a turn that was open again at most.
 */
export class TurnUsage {
    private readonly now: () => number;
    // The turn each chat last opened, so a turn counts once however often its item changes.
    private readonly counted = new Map<string, string>();
    // When a chat's open turn started, until its first words came.
    private readonly awaitingWords = new Map<string, number>();
    // The turn each chat last stopped on a usage limit with, until the next turn opens.
    private readonly limited = new Map<string, string>();

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    turn(
        chatId: string,
        item: TurnItem,
        info: Pick<ChatInfo, 'provider' | 'model' | 'selection' | 'permissionMode' | 'runtimeMode' | 'effectiveRuntimeMode'>
    ): void {
        if (item.state === 'running') {
            if (this.counted.get(chatId) === item.id) {
                return;
            }
            this.counted.set(chatId, item.id);
            this.awaitingWords.set(chatId, this.now());
            if (this.limited.delete(chatId)) {
                countUsage('limitResumes');
            }
            countTurn(
                info.provider,
                info.model ?? info.selection.model,
                info.permissionMode === 'plan' ? 'plan' : (info.effectiveRuntimeMode ?? info.runtimeMode)
            );
            return;
        }
        this.awaitingWords.delete(chatId);
        if (item.limit?.kind === 'usage' && this.counted.get(chatId) === item.id && this.limited.get(chatId) !== item.id) {
            this.limited.set(chatId, item.id);
            countLimit(info.provider);
        }
    }

    /* The first delta of an open turn: its first words. */
    words(chatId: string, provider: string): void {
        const startedAt = this.awaitingWords.get(chatId);
        if (startedAt === undefined) {
            return;
        }
        this.awaitingWords.delete(chatId);
        recordFirstToken(provider, this.now() - startedAt);
    }

    forget(chatId: string): void {
        this.counted.delete(chatId);
        this.awaitingWords.delete(chatId);
        this.limited.delete(chatId);
    }
}
