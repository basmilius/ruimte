import { codeToHtml } from 'shiki';

const LANGUAGES = new Set(['ts', 'tsx', 'json', 'jsonc', 'css', 'bash', 'sh', 'text']);

/* Highlighted at build time, so a page carries no highlighter. */
export async function CodeBlock({ code, language = 'text' }: { readonly code: string; readonly language?: string }) {
    const html = await codeToHtml(code.replace(/\n$/, ''), {
        lang: LANGUAGES.has(language) ? language : 'text',
        theme: 'github-dark-default'
    });

    // oxlint-disable-next-line react/no-danger -- Shiki's own markup of code from this repository.
    return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
