import type { Highlighter } from 'shiki';
import { CODE_THEMES } from '@/code-themes';

let loading: Promise<Highlighter> | undefined;

/* Loading a theme again replaces its identity and invalidates document token states. */
export function codeHighlighter(): Promise<Highlighter> {
    loading ??= import('shiki')
        .then(async ({ getSingletonHighlighter }) => {
            const highlighter = await getSingletonHighlighter();
            const known = new Set(highlighter.getLoadedThemes());
            const missing = CODE_THEMES.filter((theme) => !known.has(theme.name));
            if (missing.length > 0) {
                await highlighter.loadTheme(...missing);
            }
            return highlighter;
        })
        .catch((error: unknown) => {
            loading = undefined;
            throw error;
        });
    return loading;
}
