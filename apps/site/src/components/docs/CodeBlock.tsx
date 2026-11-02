import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const THEME = 'github-dark-default';

/* A fence's language, and the grammar that draws it. */
const GRAMMARS: Readonly<Record<string, string>> = {
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    jsonc: 'jsonc',
    css: 'css',
    bash: 'shellscript',
    sh: 'shellscript'
};

let highlighter: Promise<HighlighterCore> | null = null;

/* Only the grammars in `GRAMMARS`: every grammar and theme here lands in the site's worker. */
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

/* Highlighted when the page is prerendered, so a page carries no highlighter. */
export async function CodeBlock({ code, language = 'text' }: { readonly code: string; readonly language?: string }) {
    const lang = GRAMMARS[language] ?? 'text';
    const html = (await highlighterOnce()).codeToHtml(code.replace(/\n$/, ''), { lang, theme: THEME });

    // oxlint-disable-next-line react/no-danger -- Shiki's own markup of code from this repository.
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
