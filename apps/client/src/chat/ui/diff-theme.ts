import { useMemo } from 'react';
import { registerCustomTheme, type ThemesType } from '@pierre/diffs';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { useSettings } from '@/state/settings';

// The library resolves Shiki's bundled themes by id on its own; ours it only knows by registration.
for (const theme of CODE_THEMES) {
    registerCustomTheme(theme.name, () => Promise.resolve(theme));
}

/* The code themes a diff is drawn in, the same pair the viewer, the editor and a chat's code blocks use. */
export const useDiffTheme = (): ThemesType => {
    const light = useSettings((s) => s.codeThemeLight);
    const dark = useSettings((s) => s.codeThemeDark);
    return useMemo(() => ({ light, dark }), [light, dark]);
};
