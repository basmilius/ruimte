import type { ShikiTransformer } from 'shiki';
import { shikiThemeOf } from '@/shell/panels/code-themes';

type Highlight = (code: string, language: string, theme: string) => Promise<string>;

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
const loadHighlighter = (): Promise<Highlight> => {
    loading ??= import('shiki').then(({ bundledLanguages, codeToHtml }) => async (code, language, theme) => {
        const lang = language in bundledLanguages ? language : 'text';
        return codeToHtml(code, { lang, theme: shikiThemeOf(theme), transformers: [DROP_LINE_BREAKS] });
    });
    return loading;
};

/* One block of code as highlighted HTML in a code theme. A language nothing recognizes comes back as plain text. */
export const highlightCode = (code: string, language: string, theme: string): Promise<string> =>
    loadHighlighter().then((highlight) => highlight(code, language, theme));
