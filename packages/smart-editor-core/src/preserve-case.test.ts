import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import { replaceWithCaseRespect } from './preserve-case.ts';

describe('replaceWithCaseRespect', () => {
    it('follows a capitalized, an upper case and a lower case match', () => {
        expect(replaceWithCaseRespect('bar', 'Foo')).toBe('Bar');
        expect(replaceWithCaseRespect('bar', 'FOO')).toBe('BAR');
        expect(replaceWithCaseRespect('Bar', 'foo')).toBe('bar');
        expect(replaceWithCaseRespect('BAR', 'foo')).toBe('bar');
    });

    it('leaves a replacement alone whose own case says something the match does not', () => {
        expect(replaceWithCaseRespect('bazQux', 'FooBar')).toBe('BazQux');
        expect(replaceWithCaseRespect('baZ', 'Foo')).toBe('BaZ');
    });

    it('takes only the first letter from a one letter match', () => {
        expect(replaceWithCaseRespect('barBaz', 'F')).toBe('BarBaz');
        expect(replaceWithCaseRespect('BarBaz', 'f')).toBe('barBaz');
    });

    it('keeps an empty side as it is', () => {
        expect(replaceWithCaseRespect('', 'Foo')).toBe('');
        expect(replaceWithCaseRespect('bar', '')).toBe('bar');
    });
});

describe('replacing with the case of the match', () => {
    it('applies to every match of a replace all', () => {
        const model = new DocumentModel('foo Foo FOO');
        expect(model.replaceAll('foo', 'bar', { preserveCase: true })).toBe(3);
        expect(model.getText()).toBe('bar Bar BAR');
    });

    it('applies to one match, after a regex has expanded the replacement', () => {
        const model = new DocumentModel('Hello world');
        const match = model.find('(hello) (\\w+)', { regex: true })[0]!;
        expect(model.replace(match, '$2 $1', { preserveCase: true })).toBe(true);
        expect(model.getText()).toBe('World Hello');
    });
});
