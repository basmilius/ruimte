import { create } from 'zustand';
import type { AgentKind, ChatPreferencesPayload, ModelSelection, RuntimeMode } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.chat.preferences';

export interface ChatPreferences {
    /* One remembered model per CLI: a slug only means something inside its own catalog. */
    selectionByProvider: Partial<Record<AgentKind, ModelSelection>>;
    /* Whose model was picked last, which is what a chat without a fixed provider opens on. */
    lastProvider: AgentKind | null;
    runtimeMode: RuntimeMode;
    // What an agent started as a terminal node runs in; a chat picks its own mode in the composer.
    terminalRuntimeMode: RuntimeMode;
    /* When a person last changed any of it; what settles whose pick a machine uses when several clients told it one. */
    changedAt: number;
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
    selectionByProvider: {},
    lastProvider: null,
    runtimeMode: 'full-access',
    terminalRuntimeMode: 'full-access',
    changedAt: 0
};

/*
 * Only the fields we know today, so what an older build wrote (one global `selection`, the plan
 * toggle's `interactionMode`) falls away here instead of riding along in every later write. A
 * global selection cannot be mapped back onto a provider, so it is dropped: one lost pick.
 */
export const parseChatPreferences = (raw: string | null): ChatPreferences => {
    if (raw === null) {
        return DEFAULT_CHAT_PREFERENCES;
    }
    try {
        const stored = JSON.parse(raw) as Partial<ChatPreferences>;
        return {
            selectionByProvider: { ...stored.selectionByProvider },
            lastProvider: stored.lastProvider ?? null,
            runtimeMode: stored.runtimeMode ?? DEFAULT_CHAT_PREFERENCES.runtimeMode,
            terminalRuntimeMode: stored.terminalRuntimeMode ?? DEFAULT_CHAT_PREFERENCES.terminalRuntimeMode,
            changedAt: typeof stored.changedAt === 'number' ? stored.changedAt : 0
        };
    } catch {
        return DEFAULT_CHAT_PREFERENCES;
    }
};

/* Which CLI a chat opens on when its node names none: the last one a model was picked for. */
export const defaultProvider = (preferences: ChatPreferences): AgentKind | null => preferences.lastProvider;

/* The model a chat of this provider starts with; null lets the daemon fall back to the CLI's own default. */
export const selectionFor = (preferences: ChatPreferences, provider: AgentKind | null | undefined): ModelSelection | null => {
    const owner = provider ?? preferences.lastProvider;
    if (owner === null) {
        return null;
    }
    return preferences.selectionByProvider[owner] ?? null;
};

/* The pick lands in its provider's slot and makes that provider the global default. */
export const withSelection = (preferences: ChatPreferences, provider: AgentKind, selection: ModelSelection): ChatPreferences => ({
    ...preferences,
    selectionByProvider: { ...preferences.selectionByProvider, [provider]: selection },
    lastProvider: provider
});

/* What a machine starts a chat with when it starts one with no client mounting it. */
export const chatPreferencesPayload = (preferences: ChatPreferences): ChatPreferencesPayload => ({
    runtimeMode: preferences.runtimeMode,
    selections: preferences.selectionByProvider,
    changedAt: preferences.changedAt
});

const read = (): ChatPreferences => {
    try {
        return parseChatPreferences(localStorage.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_CHAT_PREFERENCES;
    }
};

/* What a new agent starts with: the last model and modes the person picked, like a remembered default. */
export const useChatPreferences = create<ChatPreferences>(() => read());

export const readChatPreferences = (): ChatPreferences => useChatPreferences.getState();

const write = (preferences: ChatPreferences): void => {
    const next = { ...preferences, changedAt: Date.now() };
    useChatPreferences.setState(next);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage that refuses is not worth an error; the daemon's defaults still apply.
    }
};

/* The composer writes here on every change and the settings dialog too; both edit the same remembered default. */
export const rememberChatPreferences = (patch: Partial<ChatPreferences>): void => {
    write({ ...useChatPreferences.getState(), ...patch });
};

export const rememberChatSelection = (provider: AgentKind, selection: ModelSelection): void => {
    write(withSelection(useChatPreferences.getState(), provider, selection));
};

/* Back to the CLI's own default for this provider; the other providers keep what they had. */
export const forgetChatSelection = (provider: AgentKind): void => {
    const current = useChatPreferences.getState();
    const { [provider]: _dropped, ...rest } = current.selectionByProvider;
    write({ ...current, selectionByProvider: rest, lastProvider: current.lastProvider === provider ? null : current.lastProvider });
};
