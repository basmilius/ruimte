import { describe, expect, test } from 'bun:test';
import { deriveNodeTitle } from './title.ts';

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
