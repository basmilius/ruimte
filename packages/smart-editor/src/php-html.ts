import type { Highlighter } from 'shiki';

type LanguageRegistration = Extract<Parameters<Highlighter['loadLanguage']>[0], { readonly scopeName: string }>;

/* Shiki's `php` is only the code inside the tags, which makes a plain `<?php` an operator and a constant. */
export const PHP_DOCUMENT_ID = 'php-html';

/*
 * A PHP file as a document: HTML with PHP between its tags, the way `text.html.php` of the PHP
 * grammar family does it. Shiki bundles no such grammar, so it is written here on top of `html` and
 * `php`, which have to be loaded first. The tags carry the scope a theme draws a tag's brackets in.
 */
export const PHP_DOCUMENT: LanguageRegistration = {
    name: PHP_DOCUMENT_ID,
    scopeName: 'text.html.php',
    embeddedLangs: ['html', 'php'],
    patterns: [
        {
            begin: '(?i)<\\?(?:php|=)?',
            beginCaptures: { '0': { name: 'punctuation.definition.tag.begin.php' } },
            end: '\\?>',
            endCaptures: { '0': { name: 'punctuation.definition.tag.end.php' } },
            name: 'meta.embedded.block.php',
            contentName: 'source.php',
            patterns: [{ include: 'source.php' }]
        },
        { include: 'text.html.basic' }
    ]
} as LanguageRegistration;

/* The grammar to color a whole file in: a PHP file is a document, and every other language is its own. */
export function documentLanguageOf(language: string): string {
    return language === 'php' ? PHP_DOCUMENT_ID : language;
}

/* Loads what a language needs besides its own grammar; a grammar that is already in is left alone. */
export async function loadDocumentLanguage(highlighter: Highlighter, language: string): Promise<void> {
    if (language !== PHP_DOCUMENT_ID || highlighter.getLoadedLanguages().includes(PHP_DOCUMENT_ID)) {
        return;
    }
    await highlighter.loadLanguage('php');
    await highlighter.loadLanguage(PHP_DOCUMENT);
}
