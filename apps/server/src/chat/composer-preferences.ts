import type { AgentKind, ChatPreferencesPayload, ModelSelection, RuntimeMode } from '@ruimte/contracts';

export interface ComposerPreference {
    runtimeMode?: RuntimeMode;
    selection?: ModelSelection;
    // The account a new chat or agent of this CLI starts under when nothing names one.
    account?: string;
}

interface Held {
    preference: ChatPreferencesPayload;
    // The order it was told in, which settles two picks with the same `changedAt`.
    told: number;
}

/*
 * What each connected client says a new chat starts with, for the chats the daemon starts with no
 * client mounting them. Held per socket like the approval switch: a machine never remembers a
 * person's pick after that person's client is gone, so with nobody connected a chat gets the
 * daemon's own defaults.
 */
export class ComposerPreferences {
    private readonly byClient = new Map<string, Held>();
    private told = 0;

    set(clientId: string, preference: ChatPreferencesPayload): void {
        this.told += 1;
        this.byClient.set(clientId, { preference, told: this.told });
    }

    forget(clientId: string): void {
        this.byClient.delete(clientId);
    }

    /* The mode the newest pick gives a terminal agent; undefined with no client or none said. */
    terminalMode(): RuntimeMode | undefined {
        return this.newest()?.preference.terminalRuntimeMode;
    }

    /* The newest pick among the connected clients, narrowed to this provider; empty with none. */
    for(provider: AgentKind): ComposerPreference {
        const newest = this.newest();
        if (newest === null) {
            return {};
        }
        const { runtimeMode, selections, accounts } = newest.preference;
        const selection = selections?.[provider];
        const account = accounts?.[provider];
        return { ...(runtimeMode ? { runtimeMode } : {}), ...(selection ? { selection } : {}), ...(account ? { account } : {}) };
    }

    private newest(): Held | null {
        let newest: Held | null = null;
        for (const held of this.byClient.values()) {
            if (newest === null || isNewer(held, newest)) {
                newest = held;
            }
        }
        return newest;
    }
}

const isNewer = (held: Held, than: Held): boolean => {
    const changedAt = held.preference.changedAt ?? 0;
    const otherChangedAt = than.preference.changedAt ?? 0;
    return changedAt === otherChangedAt ? held.told > than.told : changedAt > otherChangedAt;
};
