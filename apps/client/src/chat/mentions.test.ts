import { describe, expect, test } from 'bun:test';
import { findMentionQuery, insertMention, presentMentions, tokenizeMentions } from './mentions';

describe('findMentionQuery', () => {
    test('opens on an @ that starts a word and follows it to the caret', () => {
        expect(findMentionQuery('look at @src/ch', 15)).toEqual({ start: 8, query: 'src/ch' });
        expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    });

    test('stays closed for an email, a closed word or a caret inside a word', () => {
        expect(findMentionQuery('mail bas@x', 10)).toBeNull();
        expect(findMentionQuery('@done and more', 14)).toBeNull();
        expect(findMentionQuery('@src/chat', 4)).toBeNull();
    });
});

describe('insertMention', () => {
    test('swaps the query for the path plus a space and moves the caret behind it', () => {
        const mention = findMentionQuery('see @cmp now', 8)!;
        expect(insertMention('see @cmp now', mention, 'src/Composer.tsx')).toEqual({ text: 'see @src/Composer.tsx  now', caret: 22 });
    });
});

describe('presentMentions', () => {
    test('keeps only chosen paths that still sit whole in the text, in text order', () => {
        expect(presentMentions('fix @b.ts then @a.ts', ['a.ts', 'b.ts', 'gone.ts'])).toEqual(['b.ts', 'a.ts']);
        expect(presentMentions('@a.tsx', ['a.ts'])).toEqual([]);
    });
});

describe('tokenizeMentions', () => {
    test('splits text around the chips and prefers the longer path', () => {
        expect(tokenizeMentions('open @src/a.ts and @src/a.ts.bak.', ['src/a.ts', 'src/a.ts.bak'])).toEqual([
            { kind: 'text', text: 'open ' },
            { kind: 'mention', path: 'src/a.ts' },
            { kind: 'text', text: ' and ' },
            { kind: 'mention', path: 'src/a.ts.bak' },
            { kind: 'text', text: '.' }
        ]);
    });

    test('plain text without mentions is one segment', () => {
        expect(tokenizeMentions('hello', [])).toEqual([{ kind: 'text', text: 'hello' }]);
        expect(tokenizeMentions('', ['x'])).toEqual([]);
    });
});
