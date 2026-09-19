import { describe, expect, test } from 'bun:test';
import { mergeSelection } from '@/state/selection';

describe('mergeSelection', () => {
    test('replace forgets what was selected', () => {
        expect(mergeSelection(['a', 'b'], ['c'], 'replace')).toEqual(['c']);
    });

    test('add keeps what is selected and never drops anything', () => {
        expect(mergeSelection(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c']);
    });

    test('toggle takes out what was already selected, which is what shift-clicking means', () => {
        expect(mergeSelection(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
    });

    test('nothing to merge leaves the selection alone', () => {
        expect(mergeSelection(['a'], [], 'toggle')).toEqual(['a']);
    });
});
