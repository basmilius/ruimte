import { describe, expect, test } from 'bun:test';
import { getSingletonHighlighter } from 'shiki';
import { CODE_PALETTES } from './code-themes';
import { highlightCode, highlightDocument } from './highlight';

// The grammar compiles its patterns on first use, which on a loaded runner outlasts the 500 ms Shiki gives a line
// and leaves the rest of it one token. The shorthand `highlightCode` draws with shares this singleton.
const warm = await getSingletonHighlighter({ themes: ['github-dark'], langs: ['typescript'] });
warm.codeToTokensBase('const answer = 42;', { lang: 'typescript', theme: 'github-dark', tokenizeTimeLimit: 0 });

describe('highlighting code', () => {
    test('draws in one of our own themes by its id', async () => {
        const html = await highlightCode('const answer = 42;', 'typescript', 'ruimte-dark');
        expect(html.toLowerCase()).toContain(CODE_PALETTES.dark.colors.keyword);
        expect(html.toLowerCase()).toContain(CODE_PALETTES.dark.colors.number);
    });

    test('still draws in a theme Shiki bundles', async () => {
        const html = await highlightCode('const answer = 42;', 'typescript', 'github-light');
        expect(html).toContain('github-light');
    });
});

describe('highlighting a whole file', () => {
    test('draws the open tag of a PHP file as a tag and not as code', async () => {
        const snippet = await highlightCode('<?php\necho 1;', 'php', 'github-dark');
        const document = await highlightDocument('<?php\necho 1;', 'php', 'github-dark');
        expect(document).not.toEqual(snippet);
        expect(document).toContain('<span');
    });

    test('draws the styles of a Vue file in a language its grammar embeds on demand', async () => {
        const html = await highlightDocument('<style lang="scss">\n.a { .b { margin: 4px; } }\n</style>', 'vue', 'github-dark');
        expect(html).toMatch(/<span style="color:#[0-9A-F]{6}">margin/i);
    });
});
