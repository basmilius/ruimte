import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';

/* The Shiki theme code is drawn in under the app's current light or dark. */
export const useCodeTheme = (): string => {
    const mode = useTheme((s) => s.resolved);
    return useSettings((s) => (mode === 'dark' ? s.codeThemeDark : s.codeThemeLight));
};
