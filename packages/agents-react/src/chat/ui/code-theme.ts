import type { ThemeRegistration } from 'shiki';
import { chatHost } from '../../host';

/* The Shiki theme code is drawn in under the app's current light or dark. */
export const useCodeTheme = (): string => {
    const { code } = chatHost();
    const mode = code.useMode();
    const themes = code.useThemes();
    return mode === 'dark' ? themes.dark : themes.light;
};

/* What to hand Shiki for a theme id: a theme the app ships itself, or the id of a bundled one for Shiki to load. */
export const shikiThemeOf = (id: string): string | ThemeRegistration => chatHost().code.custom.find((theme) => theme.name === id) ?? id;
