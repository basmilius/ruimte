import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import type { editor, IDisposable, languages } from 'monaco-editor/editor';
import type { Highlighter } from 'shiki';
import { type MonacoLanguage, monacoLanguageOf } from './languages.ts';

// A theme id the highlighter has loaded.
export type ShikiTheme = string;

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
    /* The Shiki grammar the Monaco language is drawn with. */
    readonly name: string;
    registration: IDisposable;
}

/*
 * Colors Monaco with Shiki through `@shikijs/monaco`, one grammar at a time as a file asks for it.
 * That package is written to run once over every loaded language and to patch the global
 * `monaco.editor`, so each language gets its own run against a stand-in that keeps the tokenizer; the
 * real Monaco only ever sees a tokens provider.
 */
export class ShikiBridge {
    private readonly highlighter: Highlighter;
    private readonly languages: MonacoLanguages;
    /* Per Monaco language id. */
    private readonly grammars = new Map<string, Grammar>();
    private readonly loading = new Map<string, Promise<string>>();
    private theme: ShikiTheme;

    constructor(highlighter: Highlighter, languages: MonacoLanguages, theme: ShikiTheme) {
        this.highlighter = highlighter;
        this.languages = languages;
        this.theme = theme;
    }

    /* The Monaco language id for a Shiki id (`languages.ts`), once its grammar is loaded; plain text for one Shiki does not know. */
    language(id: string | undefined): Promise<string> {
        if (id === undefined || id === '') {
            return Promise.resolve(PLAIN_TEXT);
        }
        const target = monacoLanguageOf(id);
        let loaded = this.loading.get(target.id);
        if (!loaded) {
            loaded = this.load(target);
            this.loading.set(target.id, loaded);
        }
        return loaded;
    }

    /*
     * A tokenizer turns Shiki's colors back into scopes of the one theme it was built for, so every
     * grammar gets a tokenizer of the new theme. Registering a provider again is also what makes Monaco
     * tokenize the open files anew instead of keeping the scopes of the previous theme. The new one goes
     * in before the old one goes, so the language is never without a Shiki provider, which is when
     * Monaco would reach for the Monarch tokenizer of a language definition.
     */
    setTheme(theme: ShikiTheme): void {
        if (theme === this.theme) {
            return;
        }
        this.theme = theme;
        for (const [id, grammar] of this.grammars) {
            const provider = this.tokenizer(grammar.name);
            if (provider !== null) {
                const previous = grammar.registration;
                grammar.registration = this.languages.setTokensProvider(id, provider);
                previous.dispose();
            }
        }
    }

    private async load({ id, grammar }: MonacoLanguage): Promise<string> {
        try {
            await this.highlighter.loadLanguage(grammar as Parameters<Highlighter['loadLanguage']>[0]);
        } catch {
            return PLAIN_TEXT;
        }
        // Shiki's own plain text ids load without a grammar.
        if (!this.highlighter.getLoadedLanguages().includes(grammar)) {
            return PLAIN_TEXT;
        }
        const provider = this.tokenizer(grammar);
        if (provider === null) {
            return PLAIN_TEXT;
        }
        this.languages.register({ id });
        this.grammars.set(id, { name: grammar, registration: this.languages.setTokensProvider(id, provider) });
        return id;
    }

    /* Also sets the highlighter to the current theme, which is what fills the tokenizer's colors. */
    private tokenizer(grammar: string): TokensProvider | null {
        let provider: TokensProvider | null = null;
        const standIn = {
            editor: {
                defineTheme: () => {},
                setTheme: (_theme: string) => {},
                create: () => {}
            },
            languages: {
                getLanguages: () => [{ id: grammar }],
                setTokensProvider: (_id: string, tokens: TokensProvider) => {
                    provider = tokens;
                }
            }
        };
        shikiToMonaco({ ...this.highlighter, getLoadedLanguages: () => [grammar], getLoadedThemes: () => [this.theme] }, standIn);
        return provider;
    }
}
