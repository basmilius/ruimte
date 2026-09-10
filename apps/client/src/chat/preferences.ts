import { create } from 'zustand';
import type { InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.chat.preferences';

export interface ChatPreferences {
    selection: ModelSelection | null;
    runtimeMode: RuntimeMode;
    interactionMode: InteractionMode;
    // What an agent started as a terminal node runs in; a chat picks its own mode in the composer.
    terminalRuntimeMode: RuntimeMode;
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
    selection: null,
    runtimeMode: 'full-access',
    interactionMode: 'default',
    terminalRuntimeMode: 'full-access'
};

const read = (): ChatPreferences => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_CHAT_PREFERENCES, ...(JSON.parse(raw) as Partial<ChatPreferences>) } : DEFAULT_CHAT_PREFERENCES;
    } catch {
        return DEFAULT_CHAT_PREFERENCES;
    }
};

/* What a new agent starts with: the last model and modes the person picked, like a remembered default. */
export const useChatPreferences = create<ChatPreferences>(() => read());

export const readChatPreferences = (): ChatPreferences => useChatPreferences.getState();

/* The composer writes here on every change and the settings dialog too; both edit the same remembered default. */
export const rememberChatPreferences = (patch: Partial<ChatPreferences>): void => {
    const next = { ...useChatPreferences.getState(), ...patch };
    useChatPreferences.setState(next);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage that refuses is not worth an error; the daemon's defaults still apply.
    }
};
