import { describe, expect, test } from 'bun:test';
import { mergeBaseFrom } from './compare.ts';

describe('mergeBaseFrom', () => {
    test('returns the one merge base', () => {
        expect(mergeBaseFrom({ code: 0, stdout: 'abc123\n' })).toBe('abc123');
    });

    test('says unrelated histories have no common ancestor', () => {
        expect(() => mergeBaseFrom({ code: 1, stdout: '' })).toThrow('no common ancestor');
    });

    test('refuses to pick one of several merge bases', () => {
        expect(() => mergeBaseFrom({ code: 0, stdout: 'abc123\ndef456\n' })).toThrow('more than one merge base');
    });

    test('says the read failed instead of claiming there is no ancestor', () => {
        expect(() => mergeBaseFrom({ code: 128, stdout: '' })).toThrow('The merge base could not be read');
        expect(() => mergeBaseFrom({ code: 137, stdout: '' })).toThrow('The merge base could not be read');
    });
});
