import { Fragment, memo, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { BundledLanguage, BundledTheme, createHighlighter, ThemeRegistration } from 'shiki/bundle/web';
import { IncrementalLines, type CodeToken, type Tokenize } from './code-lines';
import { CodeStreamingContext } from './code-streaming';
import { WHOLE_FADE_CLASS } from './rehype-fade';
import { shikiThemeOf, useCodeTheme } from './code-theme';

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
type GrammarState = ReturnType<Highlighter['getLastGrammarState']>;
// A plain language needs no grammar; shiki draws it in the theme's own foreground.
const PLAIN = 'text';

let highlighter: Highlighter | null = null;
let highlighterLoad: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>([PLAIN]);
const languageLoads = new Map<string, Promise<void>>();
const loadedThemes = new Set<string>();
const themeLoads = new Map<string, Promise<void>>();
const tokenizers = new Map<string, { tokenize: Tokenize<GrammarState>; fg: string | undefined }>();

// Shiki loads on the first code block, not with the app; the web bundle covers the languages a coding agent writes.
const loadHighlighter = (): Promise<Highlighter> => {
    highlighterLoad ??= import('shiki/bundle/web').then(async ({ createHighlighter }) => {
        highlighter = await createHighlighter({ themes: [], langs: [] });
        return highlighter;
    });
    return highlighterLoad;
};

const resolveLanguage = (lang: string, known: Record<string, unknown> | null): string => (known !== null && lang in known ? lang : PLAIN);

let bundled: Record<string, unknown> | null = null;

/* Loads the highlighter and the grammar of one language, once each. */
const loadLanguage = (lang: string): Promise<void> => {
    let load = languageLoads.get(lang);
    if (!load) {
        load = Promise.all([loadHighlighter(), import('shiki/bundle/web')]).then(async ([loaded, { bundledLanguages }]) => {
            bundled = bundledLanguages;
            const language = resolveLanguage(lang, bundledLanguages);
            if (!loadedLanguages.has(language)) {
                await loaded.loadLanguage(language as BundledLanguage);
                loadedLanguages.add(language);
            }
        });
        languageLoads.set(lang, load);
    }
    return load;
};

/* Loads a theme into the highlighter, once. */
const loadTheme = (theme: string): Promise<void> => {
    let load = themeLoads.get(theme);
    if (!load) {
        load = loadHighlighter().then(async (loaded) => {
            await loaded.loadTheme(shikiThemeOf(theme) as BundledTheme | ThemeRegistration);
            loadedThemes.add(theme);
        });
        themeLoads.set(theme, load);
    }
    return load;
};

/* The tokenizer for a language in a theme, or null while shiki, the grammar or the theme is still on its way. */
const tokenizerFor = (lang: string, theme: string): { tokenize: Tokenize<GrammarState>; fg: string | undefined } | null => {
    if (highlighter === null || bundled === null || !languageLoads.has(lang) || !loadedThemes.has(theme)) {
        return null;
    }
    const language = resolveLanguage(lang, bundled);
    if (!loadedLanguages.has(language)) {
        return null;
    }
    const key = `${language}:${theme}`;
    let entry = tokenizers.get(key);
    if (!entry) {
        const loaded = highlighter;
        const options = { lang: language as BundledLanguage, theme };
        entry = {
            tokenize: (code, state) => {
                const result = loaded.codeToTokens(code, state ? { ...options, grammarState: state } : options);
                return { lines: result.tokens, state: result.grammarState };
            },
            fg: loaded.getTheme(theme).fg
        };
        tokenizers.set(key, entry);
    }
    return entry;
};

const styleOf = (token: CodeToken): CSSProperties | undefined => {
    const style = token.fontStyle ?? 0;
    if (token.color === undefined && style <= 0) {
        return undefined;
    }
    const decorations = [style & 4 ? 'underline' : '', style & 8 ? 'line-through' : ''].filter(Boolean).join(' ');
    return {
        color: token.color,
        ...(style & 1 ? { fontStyle: 'italic' } : {}),
        ...(style & 2 ? { fontWeight: 'bold' } : {}),
        ...(decorations ? { textDecoration: decorations } : {})
    };
};

/* A line whose tokens did not change keeps its elements, so a selection in it survives the next delta. */
const CodeLine = memo(function CodeLine({ tokens }: { tokens: CodeToken[] }) {
    return (
        <span className="line">
            {tokens.map((token, index) => (
                <span key={index} style={styleOf(token)}>
                    {token.content}
                </span>
            ))}
        </span>
    );
});

/*
 * A fenced block, highlighted a line at a time. Until shiki and the grammar are there it holds its
 * place invisibly in the same shape, so there is never a frame of bare code that turns colored. A
 * fence that is still open is tokenized as it grows, and the same component carries on once it
 * closes, so closing it does not draw it again.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
    const theme = useCodeTheme();
    const streaming = useContext(CodeStreamingContext);
    // What loaded last, so a block whose theme changes draws again once the new one is in.
    const [loaded, setLoaded] = useState<string | null>(null);
    const tokenizer = tokenizerFor(lang, theme);
    // Only a block that had to wait fades in; one drawn highlighted from its first frame just stands there.
    const [waited] = useState(tokenizer === null);
    const lines = useMemo(() => (tokenizer ? new IncrementalLines(tokenizer.tokenize) : null), [tokenizer]);
    const tokens = useMemo(() => lines?.update(code, !streaming) ?? null, [lines, code, streaming]);

    useEffect(() => {
        if (tokenizer !== null) {
            return;
        }
        let cancelled = false;
        Promise.all([loadLanguage(lang), loadTheme(theme)])
            .then(() => !cancelled && setLoaded(`${lang}:${theme}`))
            .catch(() => !cancelled && setLoaded('failed'));
        return () => {
            cancelled = true;
        };
    }, [lang, theme, tokenizer]);

    if (tokenizer === null || tokens === null) {
        const failed = loaded === 'failed';
        return (
            <div className={clsx('chat-code', !failed && 'invisible')} aria-hidden={failed ? undefined : true}>
                <pre>
                    <code>{code}</code>
                </pre>
            </div>
        );
    }
    return (
        <div className={clsx('chat-code', waited && WHOLE_FADE_CLASS)}>
            <pre style={{ color: tokenizer.fg }}>
                <code>
                    {tokens.map((line, index) => (
                        // Lines only ever grow at the end, so the place of a line is a stable key.
                        <Fragment key={index}>
                            <CodeLine tokens={line} />
                            {index < tokens.length - 1 && '\n'}
                        </Fragment>
                    ))}
                </code>
            </pre>
        </div>
    );
}
