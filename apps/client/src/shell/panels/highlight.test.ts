import { describe, expect, test } from 'bun:test';
import { getSingletonHighlighter } from 'shiki';
import { codeHighlighter } from '@/code-highlighter';
import { CODE_PALETTES } from '../../code-themes';
import { highlightCode, highlightDocumentChunks } from './highlight';

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
        const document = await highlightDocumentChunks(['<?php\necho 1;'], 'php', 'github-dark')(0);
        expect(document).toContain('<span style="color:#E1E4E8">&#x3C;?php</span>');
        expect(snippet).toContain('<span style="color:#F97583">&#x3C;?</span><span style="color:#79B8FF">php</span>');
    });

    test('draws the styles of a Vue file in a language its grammar embeds on demand', async () => {
        const html = await highlightDocumentChunks(['<style lang="scss">\n.a { .b { margin: 4px; } }\n</style>'], 'vue', 'github-dark')(0);
        expect(html).toMatch(/<span style="color:#[0-9A-F]{6}">margin/i);
    });

    test('carries a comment across the viewer block boundary in our own theme', async () => {
        const blocks = [Array.from({ length: 399 }, () => 'const answer = 42;').join('\n') + '\n/* opening', 'still a comment */'];
        const highlight = highlightDocumentChunks(blocks, 'typescript', 'ruimte-dark');
        const html = await highlight(1);
        expect(html.toLowerCase()).toContain(CODE_PALETTES.dark.colors.comment);
        expect(html).toContain('still a comment */');
        expect(html).not.toContain('\n');
    });
});

test('the shared highlighter retains custom theme identity across snippets and viewer blocks', async () => {
    const pending = codeHighlighter();
    expect(codeHighlighter()).toBe(pending);
    const highlighter = await pending;
    const theme = highlighter.getTheme('ruimte-dark');
    await highlightCode('let shared = 1;', 'typescript', 'ruimte-dark');
    await highlightDocumentChunks(['/* opening', 'shared */'], 'typescript', 'ruimte-dark')(1);
    expect(await codeHighlighter()).toBe(highlighter);
    expect(highlighter.getTheme('ruimte-dark')).toBe(theme);
});
