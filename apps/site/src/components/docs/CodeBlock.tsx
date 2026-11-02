import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const LANGUAGES = new Set(['ts', 'tsx', 'json', 'jsonc', 'css', 'bash', 'sh', 'text']);

let highlighter: Promise<HighlighterCore> | null = null;

/* The languages the documentation shows, and nothing else: every grammar and theme here lands in the site's worker. */
function highlighterOnce(): Promise<HighlighterCore> {
    highlighter ??= createHighlighterCore({
        themes: [import('shiki/themes/github-dark-default.mjs')],
        langs: [
            import('shiki/langs/tsx.mjs'),
            import('shiki/langs/typescript.mjs'),
            import('shiki/langs/json.mjs'),
            import('shiki/langs/jsonc.mjs'),
            import('shiki/langs/css.mjs'),
            import('shiki/langs/shellscript.mjs')
        ],
        engine: createJavaScriptRegexEngine()
    });

    return highlighter;
}

const ALIASES: Readonly<Record<string, string>> = { ts: 'typescript', bash: 'shellscript', sh: 'shellscript' };

/* Highlighted when the page is prerendered, so a page carries no highlighter. */
export async function CodeBlock({ code, language = 'text' }: { readonly code: string; readonly language?: string }) {
    const lang = LANGUAGES.has(language) ? (ALIASES[language] ?? language) : 'text';
    const html = (await highlighterOnce()).codeToHtml(code.replace(/\n$/, ''), { lang, theme: 'github-dark-default' });

    // oxlint-disable-next-line react/no-danger -- Shiki's own markup of code from this repository.
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
