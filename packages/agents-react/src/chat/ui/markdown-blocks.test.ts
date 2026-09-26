import { describe, expect, test } from 'bun:test';
import { settledBlocksText, splitMarkdownBlocks } from './markdown-blocks';

const texts = (text: string): string[] => splitMarkdownBlocks(text).map((block) => block.text);

describe('splitMarkdownBlocks', () => {
    test('splits at blank lines and joins back into the text', () => {
        const text = '# Title\n\nA paragraph.\n\nAnother one.';
        expect(texts(text)).toEqual(['# Title\n\n', 'A paragraph.\n\n', 'Another one.']);
        expect(texts(text).join('')).toBe(text);
    });

    test('keeps a blank line inside a fence in the same block', () => {
        const text = 'Before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter';
        expect(texts(text)).toEqual(['Before\n\n', '```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n', 'After']);
    });

    test('marks the last block while its fence is still open', () => {
        const blocks = splitMarkdownBlocks('Intro\n\n```ts\nconst a = 1;\n\nconst b');
        expect(blocks.map((block) => block.openFence)).toEqual([false, true]);
        expect(blocks[1]!.text).toBe('```ts\nconst a = 1;\n\nconst b');
    });

    test('a shorter or different run does not close a fence', () => {
        const blocks = splitMarkdownBlocks('````\n```\n\n~~~\ntext');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.openFence).toBe(true);
    });

    test('does not split before a list item or an indented continuation', () => {
        const text = '- one\n\n- two\n\n  still two\n\nDone.';
        expect(texts(text)).toEqual(['- one\n\n- two\n\n  still two\n\n', 'Done.']);
    });

    test('leaves text with a reference definition in one piece', () => {
        const text = 'See [the docs][docs].\n\nMore.\n\n[docs]: https://ruimte.app';
        expect(texts(text)).toEqual([text]);
    });

    test('an empty text is one empty block', () => {
        expect(splitMarkdownBlocks('')).toEqual([{ text: '', openFence: false }]);
    });

    test('a fence line with an info string does not close a fence', () => {
        const blocks = splitMarkdownBlocks('```\ncode\n```ts\n\nstill code');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.openFence).toBe(true);
    });

    test('a closing fence more than three spaces deeper than its opening is a line of code', () => {
        expect(splitMarkdownBlocks('```\ncode\n    ```\n\nstill code')[0]!.openFence).toBe(true);
        expect(splitMarkdownBlocks('- item\n  ```\n  code\n     ```\n\nAfter').map((block) => block.openFence)).toEqual([false, false]);
    });

    test('a line with only a no-break space is not a blank line', () => {
        const text = 'One\n\u00a0\nTwo';
        expect(texts(text)).toEqual([text]);
    });
});

describe('settledBlocksText', () => {
    test('holds back the block still being written', () => {
        expect(settledBlocksText('First paragraph.\n\nSecond, still')).toBe('First paragraph.\n\n');
        expect(settledBlocksText('Only one so far')).toBe('');
    });

    test('a blank line alone does not settle a block, since the next line may continue it', () => {
        expect(settledBlocksText('- one\n\n')).toBe('');
        expect(settledBlocksText('- one\n\n- two')).toBe('');
        expect(settledBlocksText('- one\n\nDone')).toBe('- one\n\n');
    });

    test('an open fence is never settled, blank lines inside it included', () => {
        expect(settledBlocksText('Intro\n\n```ts\nconst a = 1;\n\nconst b')).toBe('Intro\n\n');
    });

    test('holds a heading until the block under it settles', () => {
        expect(settledBlocksText('Intro\n\n## Setup\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('Intro\n\n# Plan\n\n## Setup\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('Intro\n\n# Plan\n\n## Setup\n\nInstall it.\n\nNext')).toBe('Intro\n\n# Plan\n\n## Setup\n\nInstall it.\n\n');
    });

    test('settles the paragraph above a heading with no blank line between them', () => {
        expect(settledBlocksText('Intro\n## Setup\n\nInstall')).toBe('Intro\n');
    });

    test('holds a line of only bold text like a heading', () => {
        expect(settledBlocksText('**Risk by area:**\n\n| a |\n|---|\n')).toBe('');
        expect(settledBlocksText('Intro\n\n**Use *bun* now**\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('**Note:** read this.\n\nNext')).toBe('**Note:** read this.\n\n');
        // Right under a line of text, a bold line continues that paragraph.
        expect(settledBlocksText('Intro\n**Setup**\n\nInstall')).toBe('Intro\n**Setup**\n\n');
    });

    test('holds a heading above a code block until the fence closes', () => {
        expect(settledBlocksText('## Code\n\n```ts\na\n\nb\n')).toBe('');
        expect(settledBlocksText('## Code\n\n```ts\na\n```\n\nAfter')).toBe('## Code\n\n```ts\na\n```\n\n');
    });
});
