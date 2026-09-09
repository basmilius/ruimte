import type { InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.chat.preferences';

export interface ChatPreferences {
    selection: ModelSelection | null;
    runtimeMode: RuntimeMode;
    interactionMode: InteractionMode;
}

const DEFAULTS: ChatPreferences = { selection: null, runtimeMode: 'full-access', interactionMode: 'default' };

/* What a new chat starts with: the last model and modes the person picked, like a remembered default. */
export const readChatPreferences = (): ChatPreferences => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChatPreferences>) } : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
};

export const rememberChatPreferences = (patch: Partial<ChatPreferences>): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readChatPreferences(), ...patch }));
    } catch {
        // Storage that refuses is not worth an error; the daemon's defaults still apply.
    }
};
