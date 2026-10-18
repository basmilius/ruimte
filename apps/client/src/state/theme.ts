import { create } from 'zustand';
import { storedText } from '@/state/stored-json';
import { usePalette } from '@/state/palette';

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'ruimte.theme';
const storedThemeKey = storedText(THEME_STORAGE_KEY);

function systemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolvedOf(theme: Theme): 'light' | 'dark' {
    return theme === 'system' ? systemTheme() : theme;
}

function storedTheme(): Theme {
    return (storedThemeKey.read() as Theme | null) ?? 'system';
}

function apply(theme: Theme): void {
    document.documentElement.dataset.theme = resolvedOf(theme);
}

interface ThemeState {
    theme: Theme;
    resolved: 'light' | 'dark';
    setTheme(theme: Theme): void;
    toggle(): void;
    /* Follows what another window wrote, without writing it back. */
    reload(): void;
}

export const useTheme = create<ThemeState>((set, get) => {
    const initial = storedTheme();
    apply(initial);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (get().theme === 'system') {
            apply('system');
            set({ resolved: systemTheme() });
        }
    });
    return {
        theme: initial,
        resolved: resolvedOf(initial),
        setTheme(theme) {
            storedThemeKey.write(theme);
            apply(theme);
            set({ theme, resolved: resolvedOf(theme) });
        },
        toggle() {
            get().setTheme(get().resolved === 'dark' ? 'light' : 'dark');
        },
        reload() {
            const theme = storedTheme();
            apply(theme);
            set({ theme, resolved: resolvedOf(theme) });
        }
    };
});

/* What paints the theme's colors where no style rule reaches (a canvas element, the window behind the
   page) reads them again when this changes: the side, or a color a person put over it. */
export function usePaletteKey(): string {
    const resolved = useTheme((s) => s.resolved);
    const revision = usePalette((s) => s.revision);
    return `${resolved}:${revision}`;
}
