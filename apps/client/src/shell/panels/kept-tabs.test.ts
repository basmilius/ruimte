import { describe, expect, test } from 'bun:test';
import { keptTabs, shownAfter } from './kept-tabs';

const tabs = (...keys: string[]) => keys.map((key) => ({ key }));

describe('the tabs that keep their editor', () => {
    test('put the tab shown now first and keep the others in the order they were shown', () => {
        expect(shownAfter([], 'a')).toEqual(['a']);
        expect(shownAfter(['a'], 'b')).toEqual(['b', 'a']);
        expect(shownAfter(['b', 'a'], 'a')).toEqual(['a', 'b']);
        expect(shownAfter(['c', 'b', 'a'], 'd', 3)).toEqual(['d', 'c', 'b']);
    });

    test('are the tab up and the open tabs shown before it, at most the limit', () => {
        expect(keptTabs('b', ['a'], tabs('a', 'b', 'c')).map((tab) => tab.key)).toEqual(['b', 'a']);
        expect(keptTabs('c', ['b', 'a'], tabs('a', 'c')).map((tab) => tab.key)).toEqual(['c', 'a']);
        expect(keptTabs('d', ['c', 'b', 'a'], tabs('a', 'b', 'c', 'd'), 2).map((tab) => tab.key)).toEqual(['d', 'c']);
        expect(keptTabs('a', [], tabs()).map((tab) => tab.key)).toEqual([]);
    });
});
