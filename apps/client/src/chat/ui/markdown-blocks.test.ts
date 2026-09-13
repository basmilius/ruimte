import { describe, expect, test } from 'bun:test';
import { splitMarkdownBlocks } from '@/chat/ui/markdown-blocks';

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
});
