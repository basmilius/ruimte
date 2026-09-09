import { create } from 'zustand';
import { NODE_ACCENTS } from '@/canvas/accents';

const STORAGE_KEY = 'ruimte.settings';

export const MONO_FONTS = [
    { id: 'system', label: 'System', stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
    { id: 'fira', label: 'Fira Code', stack: '"Fira Code", ui-monospace, Menlo, monospace' },
    { id: 'menlo', label: 'Menlo', stack: 'Menlo, ui-monospace, monospace' }
] as const;

export type MonoFontId = (typeof MONO_FONTS)[number]['id'];

export interface Settings {
    /* One of the node accents, or null for the theme's own accent. */
    accent: string | null;
    font: MonoFontId;
}

interface SettingsStore extends Settings {
    /* Bumped on every change, so a terminal knows to read the tokens again. */
    version: number;
    update(patch: Partial<Settings>): void;
}

const DEFAULTS: Settings = { accent: null, font: 'system' };

const read = (): Settings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
};

/* The few tokens a person may change are set on the root, over the theme's own values. */
const apply = (settings: Settings): void => {
    const root = document.documentElement.style;
    const accent = NODE_ACCENTS.find((entry) => entry.id === settings.accent)?.color;
    if (accent) {
        root.setProperty('--accent', accent);
        root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 16%, var(--surface))`);
        root.setProperty('--term-cursor', accent);
    } else {
        root.removeProperty('--accent');
        root.removeProperty('--accent-soft');
        root.removeProperty('--term-cursor');
    }
    const font = MONO_FONTS.find((entry) => entry.id === settings.font);
    if (font && font.id !== 'system') {
        root.setProperty('--font-mono', font.stack);
    } else {
        root.removeProperty('--font-mono');
    }
};

export const useSettings = create<SettingsStore>((set, get) => {
    const initial = read();
    apply(initial);
    return {
        ...initial,
        version: 0,
        update(patch) {
            const next: Settings = { accent: get().accent, font: get().font, ...patch };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Storage that refuses still leaves the setting on for this session.
            }
            apply(next);
            set({ ...next, version: get().version + 1 });
        }
    };
});
