import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ruimte.theme';

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
}

export const useTheme = create<ThemeState>((set, get) => {
    const initial = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';
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
            localStorage.setItem(STORAGE_KEY, theme);
            apply(theme);
            set({ theme, resolved: theme === 'system' ? systemTheme() : theme });
        },
        toggle() {
            get().setTheme(get().resolved === 'dark' ? 'light' : 'dark');
        }
    };
});
