import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';

export function useCodeTheme(): string {
    const mode = useTheme((s) => s.resolved);
    return useSettings((s) => (mode === 'dark' ? s.codeThemeDark : s.codeThemeLight));
}
