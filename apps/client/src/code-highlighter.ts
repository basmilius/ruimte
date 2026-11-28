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

interface Grammar {
    load(): Promise<object>;
    onFailure(reason: string): void;
    loading?: Promise<void>;
}

// The grammars that come from outside Shiki's own bundle, by the language they color, each loaded when a file first asks.
const grammars = new Map<string, Grammar>();

/*
 * A grammar for a language Shiki does not bundle, as TextMate JSON, read when the first file of that language is
 * colored. Answers how to take it out again; a grammar the highlighter already loaded stays until the page reloads,
 * since Shiki only adds.
 */
export function registerGrammar(language: string, load: () => Promise<object>, onFailure: (reason: string) => void): () => void {
    const grammar: Grammar = { load, onFailure };

    grammars.set(language, grammar);

    return () => {
        if (grammars.get(language) === grammar) {
            grammars.delete(language);
        }
    };
}

async function loadRegistered(language: string, grammar: Grammar): Promise<void> {
    const [{ bundledLanguages }, highlighter] = await Promise.all([import('shiki'), codeHighlighter()]);

    // A language Ruimte colors itself keeps its own grammar, also under an alias a file never asks by.
    if (language in bundledLanguages || highlighter.getLoadedLanguages().includes(language)) {
        return;
    }

    await highlighter.loadLanguage({ ...(await grammar.load()), name: language } as Parameters<Highlighter['loadLanguage']>[0]);
}

/*
 * Settles once the registered grammar of a language is in the highlighter, before the editor or the viewer asks Shiki
 * for it by name. A grammar that fails to load leaves the file plain text and says why to whoever registered it.
 */
export async function ensureGrammar(language: string | undefined): Promise<void> {
    const grammar = language === undefined ? undefined : grammars.get(language);

    if (language === undefined || grammar === undefined) {
        return;
    }

    grammar.loading ??= loadRegistered(language, grammar).catch((error: unknown) => {
        grammar.loading = undefined;
        grammar.onFailure(error instanceof Error ? error.message : String(error));
    });

    await grammar.loading;
}
