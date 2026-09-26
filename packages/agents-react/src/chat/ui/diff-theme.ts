import { useMemo } from 'react';
import { registerCustomTheme, type ThemesType } from '@pierre/diffs';
import { chatHost } from '../../host';

let registered = false;

/* The library resolves Shiki's bundled themes by id on its own; the app's own it only knows by registration, done once the host is set. */
const registerThemes = (): void => {
    if (registered) {
        return;
    }
    registered = true;
    for (const theme of chatHost().code.custom) {
        registerCustomTheme(theme.name, () => Promise.resolve(theme));
    }
};

/* The code themes a diff is drawn in, the same pair a chat's code blocks use. */
export const useDiffTheme = (): ThemesType => {
    registerThemes();
    const { light, dark } = chatHost().code.useThemes();
    return useMemo(() => ({ light, dark }), [light, dark]);
};
