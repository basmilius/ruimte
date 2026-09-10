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

export const FONT_SIZE_RANGE = { min: 10, max: 20, step: 1 } as const;

export interface Settings {
    /* One of the node accents, or null for the theme's own accent. */
    accent: string | null;
    font: MonoFontId;
    /* Terminal font size in px; every terminal refits when it changes. */
    fontSize: number;
}

interface SettingsStore extends Settings {
    /* Bumped on every change, so a terminal knows to read the tokens again. */
    version: number;
    update(patch: Partial<Settings>): void;
}

export const DEFAULT_SETTINGS: Settings = { accent: null, font: 'system', fontSize: 13 };

// Rounded as well as clamped: the stepper used to move in halves, so a browser can still hand back
// a half pixel from before, and the terminal renders sharpest on a whole one.
const clampFontSize = (value: unknown): number => {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_SETTINGS.fontSize;
    return Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, size));
};

const read = (): Settings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
        return { ...DEFAULT_SETTINGS, ...stored, fontSize: clampFontSize(stored.fontSize) };
    } catch {
        return DEFAULT_SETTINGS;
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
            const { accent, font, fontSize } = get();
            const next: Settings = { accent, font, fontSize, ...patch };
            next.fontSize = clampFontSize(next.fontSize);
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
