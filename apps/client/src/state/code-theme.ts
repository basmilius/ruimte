import { create } from 'zustand';
import { useTheme } from '@/state/theme';

// TODO(Bas): temporary, to pick the code colors by trying them; once picked, fix the two names here and drop the menu.
export const DEFAULT_CODE_THEMES = { light: 'github-light', dark: 'github-dark' } as const;

const STORAGE_KEY = 'ruimte.code-theme';

type Mode = 'light' | 'dark';

interface CodeThemeState {
    light: string;
    dark: string;
    setCodeTheme(mode: Mode, name: string): void;
}

const stored = (): Partial<Record<Mode, string>> => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<Mode, string>>;
    } catch {
        return {};
    }
};

export const useCodeThemes = create<CodeThemeState>((set, get) => ({
    ...DEFAULT_CODE_THEMES,
    ...stored(),
    setCodeTheme(mode, name) {
        set({ [mode]: name });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ light: get().light, dark: get().dark }));
    }
}));

/* The Shiki theme code is drawn in under the app's current light or dark. */
export const useCodeTheme = (): string => {
    const mode = useTheme((s) => s.resolved);
    return useCodeThemes((s) => s[mode]);
};
