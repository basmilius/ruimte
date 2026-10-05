import { beforeAll, describe, expect, test } from 'bun:test';
import { createHighlighter, type Highlighter } from 'shiki';
import { shikiTokenizers } from './shiki.ts';

const THEME = 'github-dark';
/* The theme's plain text color; a token in it was not colored by a grammar. */
const PLAIN = '#E1E4E8';

let highlighter: Highlighter;

beforeAll(async () => {
    highlighter = await createHighlighter({ themes: [THEME], langs: [] });
});

/* The words of every line with the colors the editor's tokenizer gives them, a line at a time the way the editor feeds it. */
async function colorsOf(language: string, text: string): Promise<Map<string, string>> {
    const tokenizer = await shikiTokenizers(async () => highlighter)(language, THEME, text);
    expect(tokenizer).not.toBeNull();
    const words = new Map<string, string>();
    let state: unknown = null;
    for (const line of text.split('\n')) {
        const result = tokenizer!.tokenizeLine(line, state);
        state = result.state;
        let at = 0;
        for (const token of result.tokens) {
            const word = line.slice(at, at + token.length).trim();
            if (word !== '' && !words.has(word)) {
                words.set(word, token.color);
            }
            at += token.length;
        }
    }
    return words;
}

function expectColored(colors: Map<string, string>, words: readonly string[]): void {
    for (const word of words) {
        expect({ word, color: colors.get(word) }).not.toEqual({ word, color: PLAIN });
        expect({ word, known: colors.has(word) }).toEqual({ word, known: true });
    }
}

const VUE = [
    '<template>',
    '    <div class="box">{{ total }}</div>',
    '</template>',
    '',
    '<script setup lang="ts">',
    "import { ref } from 'vue';",
    'const total: number = 1;',
    '</script>',
    '',
    '<style scoped>',
    '.box { color: red; }',
    '</style>',
    '',
    '<style lang="scss">',
    '.outer { .inner { margin: 4px; } }',
    '</style>'
].join('\n');

describe('embedded grammars', () => {
    test('colors the script and the style of a Vue file next to its template', async () => {
        const colors = await colorsOf('vue', VUE);
        expectColored(colors, ['template', 'import', 'const', "'vue'", 'color', 'red']);
    });

    test('colors a style block in a language the grammar embeds only on demand', async () => {
        const colors = await colorsOf('vue', VUE);
        expect(colors.get('margin')).toBeDefined();
        expect(colors.get('margin')).not.toBe(PLAIN);
    });

    test('colors the script and the style of an HTML file', async () => {
        const colors = await colorsOf('html', '<script>\nconst a = 1;\n</script>\n<style>\n.a { color: red; }\n</style>');
        expectColored(colors, ['const', 'color', 'red']);
    });

    test('colors the fences of a Markdown file in the language they name', async () => {
        const colors = await colorsOf('markdown', '# Title\n\n```scss\n.a { .b { margin: 4px; } }\n```\n\n```ts\nconst a = 1;\n```');
        expectColored(colors, ['const', 'margin']);
    });

    test('asks for a recoloring once a language that loads later has rebuilt the grammar', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenizer = (await shikiTokenizers(async () => fresh)('vue', THEME, VUE))!;
        expect(tokenizer.stale?.()).toBe(false);
        await fresh.loadLanguage('less');
        expect(tokenizer.stale?.()).toBe(true);
        expect(tokenizer.stale?.()).toBe(false);
    });
});

describe('a PHP file', () => {
    test('colors the open and close tags as tags and not as an operator and a constant', async () => {
        const highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenizer = (await shikiTokenizers(async () => highlighter)('php', THEME, ''))!;
        const open = tokenizer.tokenizeLine('<?php', null);
        expect(open.tokens).toHaveLength(1);
        const mixed = tokenizer.tokenizeLine('<div><?= $name ?></div>', null);
        expect(mixed.tokens.map((token) => token.length).reduce((sum, length) => sum + length, 0)).toBe(23);
        expect(mixed.tokens.length).toBeGreaterThan(3);
    });

    test('keeps the code between the tags a PHP grammar colors', async () => {
        const colors = await colorsOf('php', '<?php\n\nnamespace App;\n\necho "hi";\n?>\n<p>text</p>');
        expectColored(colors, ['namespace', 'echo', '"hi"', 'p']);
    });
});
