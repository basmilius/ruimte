import type { ShikiTransformer } from 'shiki';
import { codeHighlighter } from '@/code-highlighter';
import { shikiThemeOf } from '@/code-themes';

type Highlight = (code: string, language: string, theme: string, document: boolean) => Promise<string>;

/* Every line is a block so a line number can hang off it, and Shiki's newline between them would double the spacing. */
const DROP_LINE_BREAKS: ShikiTransformer = {
    code(node) {
        node.children = node.children.filter((child) => child.type !== 'text' || child.value !== '\n');
    }
};

type Highlighter = Awaited<ReturnType<typeof codeHighlighter>>;

async function withTheme(highlighter: Highlighter, theme: string): Promise<void> {
    if (!highlighter.getLoadedThemes().includes(theme)) {
        await highlighter.loadTheme(shikiThemeOf(theme) as Parameters<Highlighter['loadTheme']>[0]);
    }
}

let loading: Promise<Highlight> | null = null;

/* Loads on the first code file, never with the app. The full bundle, not the chat's web one: a
   folder holds Go, Rust and TOML as readily as it holds TypeScript, and a grammar is fetched only
   when a file asks for it. */
function loadHighlighter(): Promise<Highlight> {
    loading ??= Promise.all([import('shiki'), import('@adecore/editor/shiki')]).then(
        ([{ bundledLanguages }, { documentLanguageOf, loadGrammar }]) =>
            async (code, language, theme, document) => {
                const grammar = document ? documentLanguageOf(language) : language;
                const known = grammar in bundledLanguages || grammar !== language;
                // The editor's own loader, so a file reads the same in both and embedded languages come with it.
                const highlighter = await codeHighlighter();
                const lang = known && (await loadGrammar(highlighter, grammar, code)) ? grammar : 'text';
                await withTheme(highlighter, theme);
                return highlighter.codeToHtml(code, { lang, theme, transformers: [DROP_LINE_BREAKS] });
            }
    );
    return loading;
}

const SNIPPET_CACHE_SIZE = 200;
const snippets = new Map<string, Promise<string>>();

/*
 * One block of code as highlighted HTML in a code theme. A language nothing recognizes comes back as plain text.
 * A signature in a card is asked for again at every keystroke, so a block already done is not tokenized twice.
 */
export function highlightCode(code: string, language: string, theme: string): Promise<string> {
    const key = `${language}\0${theme}\0${code}`;
    const known = snippets.get(key);
    if (known !== undefined) {
        snippets.delete(key);
        snippets.set(key, known);
        return known;
    }
    const result = loadHighlighter().then((highlight) => highlight(code, language, theme, false));
    snippets.set(key, result);
    result.catch(() => snippets.delete(key));
    if (snippets.size > SNIPPET_CACHE_SIZE) {
        snippets.delete(snippets.keys().next().value!);
    }
    return result;
}

export function highlightDocumentChunks(blocks: readonly string[], language: string, theme: string): (index: number) => Promise<string> {
    let loading: Promise<(index: number) => Promise<string>> | undefined;
    return (index) => {
        loading ??= Promise.all([codeHighlighter(), import('@adecore/editor/shiki')])
            .then(async ([highlighter, { shikiDocumentHighlighter }]) => {
                await withTheme(highlighter, theme);
                return shikiDocumentHighlighter(async () => highlighter, blocks, language, theme, [DROP_LINE_BREAKS]);
            })
            .catch((error: unknown) => {
                loading = undefined;
                throw error;
            });
        return loading.then((highlight) => highlight(index));
    };
}
