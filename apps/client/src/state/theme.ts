import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'ruimte.theme';

const systemTheme = (): 'light' | 'dark' => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const apply = (theme: Theme): void => {
    const resolved = theme === 'system' ? systemTheme() : theme;
    document.documentElement.dataset.theme = resolved;
};

interface ThemeState {
    theme: Theme;
    resolved: 'light' | 'dark';
    setTheme(theme: Theme): void;
    toggle(): void;
    /* Follows what another window wrote, without writing it back. */
    reload(): void;
}

export const useTheme = create<ThemeState>((set, get) => {
    const initial = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system';
    apply(initial);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (get().theme === 'system') {
            apply('system');
            set({ resolved: systemTheme() });
        }
    });
    return {
        theme: initial,
        resolved: initial === 'system' ? systemTheme() : initial,
        setTheme(theme) {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
            apply(theme);
            set({ theme, resolved: theme === 'system' ? systemTheme() : theme });
        },
        toggle() {
            get().setTheme(get().resolved === 'dark' ? 'light' : 'dark');
        },
        reload() {
            const theme = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system';
            apply(theme);
            set({ theme, resolved: theme === 'system' ? systemTheme() : theme });
        }
    };
});
