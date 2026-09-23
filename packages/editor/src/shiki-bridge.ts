import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import type { editor, IDisposable, languages } from 'monaco-editor/editor';
import type { Highlighter } from 'shiki';

export type ShikiTheme = 'github-light' | 'github-dark';

export const SHIKI_THEMES: readonly ShikiTheme[] = ['github-light', 'github-dark'];

export const PLAIN_TEXT = 'plaintext';

type TokensProvider = languages.TokensProvider | languages.EncodedTokensProvider;

/* The part of `monaco.languages` the bridge uses, so a test can stand in for it without a DOM. */
export interface MonacoLanguages {
    register(language: { id: string }): void;
    setTokensProvider(languageId: string, provider: TokensProvider): IDisposable;
}

/* `@shikijs/monaco` types its theme against `monaco-editor-core`, which is the same editor under another name and not installed here. */
export const monacoTheme = (highlighter: Highlighter, theme: ShikiTheme): editor.IStandaloneThemeData =>
    textmateThemeToMonacoTheme(highlighter.getTheme(theme)) as editor.IStandaloneThemeData;

interface Grammar {
    readonly provider: TokensProvider;
    readonly followTheme: (theme: ShikiTheme) => void;
    registration: IDisposable;
}

/*
 * Colors Monaco with Shiki through `@shikijs/monaco`, one grammar at a time as a file asks for it.
 * That package is written to run once over every loaded language and to patch the global
 * `monaco.editor`, so each language gets its own run against a stand-in that keeps the tokenizer and
 * the call that moves its colors to another theme; the real Monaco only ever sees a tokens provider.
 */
export class ShikiBridge {
    private readonly highlighter: Highlighter;
    private readonly languages: MonacoLanguages;
    private readonly grammars = new Map<string, Grammar>();
    private readonly loading = new Map<string, Promise<string>>();
    private theme: ShikiTheme;

    constructor(highlighter: Highlighter, languages: MonacoLanguages, theme: ShikiTheme) {
        this.highlighter = highlighter;
        this.languages = languages;
        this.theme = theme;
    }

    /* The Monaco language id for a Shiki id, once its grammar is loaded; plain text for one Shiki does not know. */
    language(id: string | undefined): Promise<string> {
        if (id === undefined || id === '') {
            return Promise.resolve(PLAIN_TEXT);
        }
        let loaded = this.loading.get(id);
        if (!loaded) {
            loaded = this.load(id);
            this.loading.set(id, loaded);
        }
        return loaded;
    }

    /*
     * Shiki tokenizes with whichever theme it was last set to, and a tokenizer turns those colors back
     * into scopes of its theme, so every grammar follows along. Registering a provider again is what
     * makes Monaco tokenize the open files anew instead of keeping the scopes of the previous theme.
     */
    setTheme(theme: ShikiTheme): void {
        if (theme === this.theme) {
            return;
        }
        this.theme = theme;
        for (const [id, grammar] of this.grammars) {
            grammar.followTheme(theme);
            grammar.registration.dispose();
            grammar.registration = this.languages.setTokensProvider(id, grammar.provider);
        }
    }

    private async load(id: string): Promise<string> {
        try {
            await this.highlighter.loadLanguage(id as Parameters<Highlighter['loadLanguage']>[0]);
        } catch {
            return PLAIN_TEXT;
        }
        // Shiki's own plain text ids load without a grammar.
        if (!this.highlighter.getLoadedLanguages().includes(id)) {
            return PLAIN_TEXT;
        }
        let provider: TokensProvider | null = null;
        const editor = {
            defineTheme: () => {},
            setTheme: (_theme: string) => {},
            create: () => {}
        };
        const standIn = {
            editor,
            languages: {
                getLanguages: () => [{ id }],
                setTokensProvider: (_id: string, tokens: TokensProvider) => {
                    provider = tokens;
                }
            }
        };
        const other = this.theme === 'github-light' ? 'github-dark' : 'github-light';
        shikiToMonaco({ ...this.highlighter, getLoadedLanguages: () => [id], getLoadedThemes: () => [this.theme, other] }, standIn);
        if (provider === null) {
            return PLAIN_TEXT;
        }
        this.languages.register({ id });
        const followTheme = editor.setTheme;
        this.grammars.set(id, { provider, followTheme, registration: this.languages.setTokensProvider(id, provider) });
        return id;
    }
}
