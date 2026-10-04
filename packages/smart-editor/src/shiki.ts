import type { GrammarState, Highlighter } from 'shiki';
import { scopeColorsOf, type ThemeRule } from './theme-scopes.ts';
import type { LineToken, LineTokenizer, ScopeColorSource, TokenizerSource } from './types.ts';

type LanguageId = Parameters<Highlighter['loadLanguage']>[0];
type ThemeId = Parameters<Highlighter['loadTheme']>[0];
type TokenOptions = Parameters<Highlighter['codeToTokensBase']>[1];

const PLAIN_TEXT = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/* Colors one line at a time and hands the grammar's state from one line to the next. */
function lineTokenizer(highlighter: Highlighter, language: string, theme: string): LineTokenizer {
    return {
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

/*
 * Colors with the viewer's highlighter, so a grammar loads once for both. A language Shiki has no
 * grammar for, or a theme it cannot load, is plain text.
 */
export function shikiTokenizers(highlighter: () => Promise<Highlighter>): TokenizerSource {
    return async (language, theme) => {
        if (language === undefined || PLAIN_TEXT.has(language)) {
            return null;
        }
        const shiki = await highlighter();
        try {
            if (!shiki.getLoadedThemes().includes(theme)) {
                await shiki.loadTheme(theme as ThemeId);
            }
            if (!shiki.getLoadedLanguages().includes(language)) {
                await shiki.loadLanguage(language as LanguageId);
            }
        } catch {
            return null;
        }
        return shiki.getLoadedLanguages().includes(language) ? lineTokenizer(shiki, language, theme) : null;
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
