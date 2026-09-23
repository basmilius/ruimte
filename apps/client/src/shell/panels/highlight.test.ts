import { describe, expect, test } from 'bun:test';
import { CODE_PALETTES } from './code-themes';
import { highlightCode } from './highlight';

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
