import { describe, expect, test } from 'bun:test';
import { quoteOf, withQuote } from '@/chat/quote';

describe('the text a selection quotes', () => {
    test('is nothing when only whitespace is selected', () => {
        expect(quoteOf('')).toBeNull();
        expect(quoteOf('  \n\t\n ')).toBeNull();
    });

    test('drops the blank lines around it and the spaces at the end of a line', () => {
        expect(quoteOf('\n\nThe cache is per machine.  \n\n')).toBe('The cache is per machine.');
        expect(quoteOf('first  \r\nsecond')).toBe('first\nsecond');
    });

    test('keeps one blank line between paragraphs, and the indent of a line', () => {
        expect(quoteOf('One.\n\n\n\nTwo.\n    code')).toBe('One.\n\nTwo.\n    code');
    });
});

describe('a message with a quote', () => {
    test('goes out as it was typed without one', () => {
        expect(withQuote('', 'Why?')).toBe('Why?');
    });

    test('puts every line of the quote in a blockquote above the message', () => {
        expect(withQuote('One.\n\nTwo.', 'Why?')).toBe('> One.\n>\n> Two.\n\nWhy?');
    });

    test('is only the blockquote when nothing was typed', () => {
        expect(withQuote('One.', '')).toBe('> One.');
    });
});
