import type { GrammarState, Highlighter } from 'shiki';
import { documentLanguageOf, loadDocumentLanguage } from './php-html.ts';
import { scopeColorsOf, type ThemeRule } from './theme-scopes.ts';
import type { LineToken, LineTokenizer, ScopeColorSource, TokenizerSource } from './types.ts';

type LanguageId = Parameters<Highlighter['loadLanguage']>[0];
type ThemeId = Parameters<Highlighter['loadTheme']>[0];
type TokenOptions = Parameters<Highlighter['codeToTokensBase']>[1];

export { documentLanguageOf };

const PLAIN_TEXT = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/* Colors one line at a time and hands the grammar's state from one line to the next. A grammar Shiki rebuilt does not know the states of the old one. */
function lineTokenizer(highlighter: Highlighter, language: string, theme: string): LineTokenizer {
    let grammar = highlighter.getLanguage(language);
    return {
        stale() {
            const current = highlighter.getLanguage(language);
            const changed = current !== grammar;
            grammar = current;
            return changed;
        },
        tokenizeLine(text, state) {
            const options = { lang: language, theme, grammarState: (state ?? undefined) as GrammarState | undefined } as TokenOptions;
            const lines = highlighter.codeToTokensBase(text, options);
            const tokens: LineToken[] = (lines[0] ?? []).map((token) => ({
                length: token.content.length,
                color: token.color ?? '',
                fontStyle: token.fontStyle ?? 0
            }));
            return { tokens, state: highlighter.getLastGrammarState(lines) };
        },
        sameState(a, b) {
            if (a === b) {
                return true;
            }
            const left = (a as GrammarState | null)?.getInternalStack(theme);
            const right = (b as GrammarState | null)?.getInternalStack(theme);
            return left !== undefined && right !== undefined && left.equals(right);
        }
    };
}

/* The words of a document that name a language, an alias or the id itself, and not part of a longer word. */
function mentions(text: string, names: readonly string[]): boolean {
    return names.some((name) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text));
}

/*
 * A grammar embeds some languages only on demand (Vue's `lang="scss"` styles, the fences of Markdown),
 * and Shiki builds the host grammar anew each time one of them loads later, which drops the states
 * of every line colored before. So the ones a document names are loaded together with the host.
 */
async function loadEmbedded(highlighter: Highlighter, grammar: string, text: string): Promise<void> {
    const { bundledLanguages, bundledLanguagesInfo } = await import('shiki');
    const bundled = bundledLanguages[grammar as keyof typeof bundledLanguages];
    if (bundled === undefined) {
        return;
    }
    const registrations = (await bundled()).default as readonly { readonly name: string; readonly embeddedLangsLazy?: readonly string[] }[];
    const lazy = registrations.find((registration) => registration.name === grammar)?.embeddedLangsLazy ?? [];
    const named = lazy.filter((id) => {
        const aliases = bundledLanguagesInfo.find((info) => info.id === id)?.aliases ?? [];
        return !highlighter.getLoadedLanguages().includes(id) && mentions(text, [id, ...aliases]);
    });
    await Promise.allSettled(named.map((id) => highlighter.loadLanguage(id as LanguageId)));
}

/*
 * Loads the grammar of a language with what a document in it embeds, and says whether Shiki has it.
 * `text` is the document, which decides the embedded languages that load only when named.
 */
export async function loadGrammar(highlighter: Highlighter, grammar: string, text = ''): Promise<boolean> {
    await loadDocumentLanguage(highlighter, grammar);
    if (!highlighter.getLoadedLanguages().includes(grammar)) {
        await highlighter.loadLanguage(grammar as LanguageId);
    }
    await loadEmbedded(highlighter, grammar, text);
    return highlighter.getLoadedLanguages().includes(grammar);
}

/*
 * Colors with the viewer's highlighter, so a grammar loads once for both. A language Shiki has no
 * grammar for, or a theme it cannot load, is plain text.
 */
export function shikiTokenizers(highlighter: () => Promise<Highlighter>): TokenizerSource {
    return async (language, theme, text) => {
        if (language === undefined || PLAIN_TEXT.has(language)) {
            return null;
        }
        const grammar = documentLanguageOf(language);
        const shiki = await highlighter();
        try {
            if (!shiki.getLoadedThemes().includes(theme)) {
                await shiki.loadTheme(theme as ThemeId);
            }
            return (await loadGrammar(shiki, grammar, text)) ? lineTokenizer(shiki, grammar, theme) : null;
        } catch {
            return null;
        }
    };
}

/* The colors of a theme's own rules by scope, so what a language server classifies is drawn in the theme's colors. */
export function shikiScopeColors(highlighter: () => Promise<Highlighter>): ScopeColorSource {
    return async (theme) => {
        const shiki = await highlighter();
        try {
            if (!shiki.getLoadedThemes().includes(theme)) {
                await shiki.loadTheme(theme as ThemeId);
            }
            return scopeColorsOf(shiki.getTheme(theme).settings as readonly ThemeRule[]);
        } catch {
            return null;
        }
    };
}
