import { describe, expect, test } from 'bun:test';
import { SUGGESTED_TITLE_LIMIT } from '@ruimte/contracts';
import { deriveNodeTitle, suggestedTitleFor } from './title.ts';

describe('suggestedTitleFor', () => {
    test('replaces a title nobody named and one the session derived', () => {
        expect(suggestedTitleFor({ title: 'Chat' }, 'Fix the flaky test')).toBe('Fix the flaky test');
        expect(suggestedTitleFor({ title: 'Why does the test fail on…', titleSource: 'auto' }, 'Fix the flaky test')).toBe('Fix the flaky test');
    });

    test('never replaces a name a person gave', () => {
        expect(suggestedTitleFor({ title: 'Mine', titleSource: 'user' }, 'Fix the flaky test')).toBeNull();
    });

    test('answers null for no suggestion and for the title the node already has, so nothing is written twice', () => {
        expect(suggestedTitleFor({ title: 'Chat' }, undefined)).toBeNull();
        expect(suggestedTitleFor({ title: 'Chat' }, '   ')).toBeNull();
        expect(suggestedTitleFor({ title: 'Fix the flaky test', titleSource: 'auto' }, ' Fix the  flaky test ')).toBeNull();
    });

    test('flattens and caps what the model wrote', () => {
        expect(suggestedTitleFor({ title: 'Chat' }, 'Two\nlines')).toBe('Two lines');
        expect(suggestedTitleFor({ title: 'Chat' }, 'x'.repeat(200))).toHaveLength(SUGGESTED_TITLE_LIMIT);
    });
});

describe('deriveNodeTitle', () => {
    test('takes the first line and leaves the rest of the prompt alone', () => {
        expect(deriveNodeTitle('Fix the flaky test\n\nIt fails on CI only')).toBe('Fix the flaky test');
    });

    test('collapses the whitespace of that line and trims it', () => {
        expect(deriveNodeTitle('   Fix   the\tflaky   test   ')).toBe('Fix the flaky test');
    });

    test('drops the punctuation a sentence ends on', () => {
        expect(deriveNodeTitle('Why does the daemon restart?')).toBe('Why does the daemon restart');
        expect(deriveNodeTitle('Ship it!!!')).toBe('Ship it');
        expect(deriveNodeTitle('Read apps/server/src/main.ts,')).toBe('Read apps/server/src/main.ts');
    });

    test('cuts a long line on a word boundary and marks the cut', () => {
        const title = deriveNodeTitle('Rewrite the session manager so a dead CLI process is noticed by the daemon');
        expect(title).toBe('Rewrite the session manager so a dead CLI…');
        expect(title!.length).toBeLessThanOrEqual(49);
    });

    test('cuts a long word where the limit falls', () => {
        expect(deriveNodeTitle(`Fix ${'a'.repeat(80)}`)).toBe(`Fix ${'a'.repeat(44)}…`);
    });

    test('answers null when nothing readable is left', () => {
        expect(deriveNodeTitle('')).toBeNull();
        expect(deriveNodeTitle('\n\nthe second line does not count')).toBeNull();
        expect(deriveNodeTitle('  ...  ')).toBeNull();
    });
});
