import type { AgentKind, ChatPreferencesPayload, ModelSelection, RuntimeMode } from '@ruimte/contracts';

export interface ComposerPreference {
    runtimeMode?: RuntimeMode;
    selection?: ModelSelection;
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

    /* The newest pick among the connected clients, narrowed to this provider; empty with none. */
    for(provider: AgentKind): ComposerPreference {
        let newest: Held | null = null;
        for (const held of this.byClient.values()) {
            if (newest === null || isNewer(held, newest)) {
                newest = held;
            }
        }
        if (newest === null) {
            return {};
        }
        const { runtimeMode, selections } = newest.preference;
        const selection = selections?.[provider];
        return { ...(runtimeMode ? { runtimeMode } : {}), ...(selection ? { selection } : {}) };
    }
}

const isNewer = (held: Held, than: Held): boolean => {
    const changedAt = held.preference.changedAt ?? 0;
    const otherChangedAt = than.preference.changedAt ?? 0;
    return changedAt === otherChangedAt ? held.told > than.told : changedAt > otherChangedAt;
};
