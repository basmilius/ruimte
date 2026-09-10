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
export const INTERFACE_FONT_SIZE_RANGE = { min: 12, max: 20, step: 1 } as const;
export const FILES_TAB_LIMIT_RANGE = { min: 1, max: 20, step: 1 } as const;

export interface Settings {
    /* One of the node accents, or null for the theme's own accent. */
    accent: string | null;
    font: MonoFontId;
    /* Terminal font size in px; every terminal refits when it changes. */
    fontSize: number;
    /* The root font size in px, so the rem-based interface scales with it. Code and the terminal
       keep their own absolute sizes and stay put. */
    interfaceFontSize: number;
    /* How many files the viewer keeps open before the oldest unpinned tab makes room. */
    filesTabLimit: number;
    /* Whether the files tree shows dotfiles; the panel's eye button writes the same value. */
    filesShowHidden: boolean;
    /* Whether the git panel groups its changed files by folder instead of listing them flat. */
    gitTree: boolean;
}

interface SettingsStore extends Settings {
    /* Bumped on every change, so a terminal knows to read the tokens again. */
    version: number;
    update(patch: Partial<Settings>): void;
}

const DEFAULT_SETTINGS: Settings = {
    accent: null,
    font: 'system',
    fontSize: 13,
    interfaceFontSize: 16,
    filesTabLimit: 5,
    filesShowHidden: false,
    gitTree: true
};

// Rounded as well as clamped: the stepper used to move in halves, so a browser can still hand back
// a half pixel from before, and both text and the terminal render sharpest on a whole one.
const clampSize = (value: unknown, range: { min: number; max: number }, fallback: number): number => {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(range.max, Math.max(range.min, size));
};

const read = (): Settings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
        return {
            ...DEFAULT_SETTINGS,
            ...stored,
            fontSize: clampSize(stored.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
            interfaceFontSize: clampSize(stored.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize),
            filesTabLimit: clampSize(stored.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit)
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
};

/* The few tokens a person may change are set on the root, over the theme's own values. */
const apply = (settings: Settings): void => {
    const root = document.documentElement.style;
    root.setProperty('font-size', `${settings.interfaceFontSize}px`);
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
            const { accent, font, fontSize, interfaceFontSize, filesTabLimit, filesShowHidden, gitTree } = get();
            const next: Settings = { accent, font, fontSize, interfaceFontSize, filesTabLimit, filesShowHidden, gitTree, ...patch };
            next.fontSize = clampSize(next.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize);
            next.interfaceFontSize = clampSize(next.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize);
            next.filesTabLimit = clampSize(next.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit);
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
