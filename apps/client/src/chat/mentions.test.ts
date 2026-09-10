import { describe, expect, test } from 'bun:test';
import { findMentionQuery, findSkillQuery, insertMention, insertSkill, presentMentions, presentSkills, tokenizeChips } from './mentions';

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

describe('tokenizeChips', () => {
    test('splits text around the chips and prefers the longer path', () => {
        expect(tokenizeChips('open @src/a.ts and @src/a.ts.bak.', ['src/a.ts', 'src/a.ts.bak'])).toEqual([
            { kind: 'text', text: 'open ' },
            { kind: 'mention', path: 'src/a.ts' },
            { kind: 'text', text: ' and ' },
            { kind: 'mention', path: 'src/a.ts.bak' },
            { kind: 'text', text: '.' }
        ]);
    });

    test('plain text without mentions is one segment', () => {
        expect(tokenizeChips('hello', [])).toEqual([{ kind: 'text', text: 'hello' }]);
        expect(tokenizeChips('', ['x'])).toEqual([]);
    });
});

describe('findSkillQuery', () => {
    test('opens on a $ that starts a word whose name starts with a letter', () => {
        expect(findSkillQuery('run $uns', 8)).toEqual({ start: 4, query: 'uns' });
        expect(findSkillQuery('$', 1)).toEqual({ start: 0, query: '' });
    });

    test('stays closed for an amount, a closed word or a caret inside a word', () => {
        expect(findSkillQuery('it costs $20', 12)).toBeNull();
        expect(findSkillQuery('$unslop and more', 16)).toBeNull();
        expect(findSkillQuery('paid us$5', 9)).toBeNull();
    });
});

describe('insertSkill', () => {
    test('swaps the query for the name plus a space', () => {
        const query = findSkillQuery('run $uns now', 8)!;
        expect(insertSkill('run $uns now', query, 'unslop')).toEqual({ text: 'run $unslop  now', caret: 12 });
    });
});

describe('presentSkills', () => {
    test('keeps only chosen names that still sit whole in the text', () => {
        expect(presentSkills('first $lint then $unslop', ['unslop', 'lint', 'gone'])).toEqual(['lint', 'unslop']);
    });
});

describe('tokenizeChips with skills', () => {
    test('draws mentions and skills as their own segments', () => {
        expect(tokenizeChips('read @a.ts then $unslop it', ['a.ts'], ['unslop'])).toEqual([
            { kind: 'text', text: 'read ' },
            { kind: 'mention', path: 'a.ts' },
            { kind: 'text', text: ' then ' },
            { kind: 'skill', name: 'unslop' },
            { kind: 'text', text: ' it' }
        ]);
    });
});
