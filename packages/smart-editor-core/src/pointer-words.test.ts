import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

describe('the word a double click selects', () => {
    it('is the identifier and not what Intl calls a word', () => {
        const model = new DocumentModel('config.value = @click.prevent');
        expect(model.wordSelectionAt(2)).toEqual({ from: 0, to: 6 });
        expect(model.wordSelectionAt(9)).toEqual({ from: 7, to: 12 });
        expect(model.wordSelectionAt(18)).toEqual({ from: 16, to: 21 });
    });

    it('keeps the sigil of a PHP variable and the underscores of a name', () => {
        const model = new DocumentModel('echo $user_name;');
        expect(model.wordSelectionAt(8)).toEqual({ from: 5, to: 15 });
    });

    it('takes the word that ends at the caret when the next character is not part of one', () => {
        const model = new DocumentModel('foo bar');
        expect(model.wordSelectionAt(3)).toEqual({ from: 0, to: 3 });
        expect(model.wordSelectionAt(7)).toEqual({ from: 4, to: 7 });
    });

    it('takes a camel hump when asked to', () => {
        const model = new DocumentModel('fooBarBaz');
        expect(model.wordSelectionAt(4, true)).toEqual({ from: 3, to: 6 });
        expect(model.wordSelectionAt(4)).toEqual({ from: 0, to: 9 });
    });

    it('is the text of the line on whitespace and punctuation, and the whole document on an empty line', () => {
        const model = new DocumentModel('a  = b\n\nc');
        expect(model.wordSelectionAt(2)).toEqual({ from: 0, to: 6 });
        expect(model.wordSelectionAt(7)).toEqual({ from: 0, to: 9 });
    });
});

describe('where a drag over words puts the head', () => {
    it('finds the start of the word before the caret and the end of the one after it', () => {
        const model = new DocumentModel('one two three');
        expect(model.wordStartBefore(6)).toBe(4);
        expect(model.wordStartBefore(4)).toBe(0);
        expect(model.wordEndAfter(4)).toBe(7);
        expect(model.wordEndAfter(7)).toBe(13);
    });

    it('stays on the line above or below and stops between two brackets', () => {
        const model = new DocumentModel('ab\n  cd\n[]');
        expect(model.wordStartBefore(3)).toBe(2);
        expect(model.wordEndAfter(1)).toBe(2);
        expect(model.wordEndAfter(2)).toBe(7);
        expect(model.wordStartBefore(9)).toBe(8);
    });
});
