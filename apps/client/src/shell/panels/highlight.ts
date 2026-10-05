import type { ShikiTransformer } from 'shiki';
import { shikiThemeOf } from '@/shell/panels/code-themes';

type Highlight = (code: string, language: string, theme: string, document: boolean) => Promise<string>;

/*
 * Shiki separates its line spans with a newline of its own. The viewer needs every line to be a
 * block, so a line number can hang off it, and a newline between blocks would draw the whole file
 * double spaced.
 */
const DROP_LINE_BREAKS: ShikiTransformer = {
    code(node) {
        node.children = node.children.filter((child) => child.type !== 'text' || child.value !== '\n');
    }
};

let loading: Promise<Highlight> | null = null;

/* Loads on the first code file, never with the app. The full bundle, not the chat's web one: a
   folder holds Go, Rust and TOML as readily as it holds TypeScript, and a grammar is fetched only
   when a file asks for it. */
function loadHighlighter(): Promise<Highlight> {
    loading ??= Promise.all([import('shiki'), import('@ruimte/smart-editor/shiki')]).then(
        ([{ bundledLanguages, getSingletonHighlighter }, { documentLanguageOf, loadGrammar }]) =>
            async (code, language, theme, document) => {
                const grammar = document ? documentLanguageOf(language) : language;
                const known = grammar in bundledLanguages || grammar !== language;
                // The editor's own loader, so a file reads the same in both and embedded languages come with it.
                const highlighter = await getSingletonHighlighter();
                const lang = known && (await loadGrammar(highlighter, grammar, code)) ? grammar : 'text';
                const shikiTheme = shikiThemeOf(theme);
                if (typeof shikiTheme === 'string' && !highlighter.getLoadedThemes().includes(shikiTheme)) {
                    await highlighter.loadTheme(shikiTheme as Parameters<typeof highlighter.loadTheme>[0]);
                }
                return highlighter.codeToHtml(code, { lang, theme: shikiTheme, transformers: [DROP_LINE_BREAKS] });
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

/* A whole file as highlighted HTML, which differs from a snippet for a language that is a document around its code, such as PHP in HTML. */
export function highlightDocument(code: string, language: string, theme: string): Promise<string> {
    return loadHighlighter().then((highlight) => highlight(code, language, theme, true));
}
