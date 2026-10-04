import { describe, expect, test } from 'bun:test';
import { entriesOf, filterEntries, groupEntries, groupOfKind, letterOfKind, modeOf, scoreOf, workspaceEntriesOf } from './symbol-picker-model';

const at = (line: number, character = 0) => ({ line, character });
const range = (line: number) => ({ start: at(line), end: at(line + 2) });

const SYMBOLS = [
    { name: 'DEFAULT_WEIGHTS', kind: 14 as const, range: range(3), selectionRange: range(3) },
    {
        name: 'Scorer',
        kind: 5 as const,
        range: range(5),
        selectionRange: range(5),
        children: [{ name: 'score', kind: 6 as const, detail: '(candidate)', range: range(6), selectionRange: { start: at(6, 4), end: at(6, 9) } }]
    },
    { name: 'scoreCandidate', kind: 12 as const, detail: '(candidate, vacancy)', range: range(9), selectionRange: range(9) }
];

describe('the symbols of a file', () => {
    test('are listed parents first, with where each sits', () => {
        const entries = entriesOf(SYMBOLS);
        expect(entries.map((entry) => [entry.name, entry.container, entry.line])).toEqual([
            ['DEFAULT_WEIGHTS', '', 3],
            ['Scorer', '', 5],
            ['score', 'Scorer', 6],
            ['scoreCandidate', '', 9]
        ]);
        expect(entries[2]).toMatchObject({ detail: '(candidate)', character: 4 });
    });

    test('are read from a flat list too, and from nothing', () => {
        const flat = [{ name: 'a', kind: 12 as const, containerName: 'M', location: { uri: 'file:///a', range: range(2) } }];
        expect(entriesOf(flat)).toMatchObject([{ name: 'a', container: 'M', line: 2 }]);
        expect(entriesOf(null)).toEqual([]);
    });

    test('are grouped by kind in the order of the groups', () => {
        const groups = groupEntries(entriesOf(SYMBOLS));
        expect(groups.map((group) => [group.group, group.entries.map((entry) => entry.name)])).toEqual([
            ['classes', ['Scorer']],
            ['functions', ['scoreCandidate']],
            ['methods', ['score']],
            ['constants', ['DEFAULT_WEIGHTS']]
        ]);
        expect(groupOfKind(99)).toBe('other');
        expect(['f', 'm', 'C', 'c'].every((letter) => [12, 6, 5, 14].map(letterOfKind).includes(letter))).toBe(true);
    });
});

describe('filtering', () => {
    test('scores a prefix over a part over its letters in order, and ignores case', () => {
        expect(scoreOf('scoreCandidate', 'SCORE')).toBe(3);
        expect(scoreOf('scoreCandidate', 'cand')).toBe(2);
        expect(scoreOf('scoreCandidate', 'scd')).toBe(1);
        expect(scoreOf('scoreCandidate', 'xyz')).toBe(0);
    });

    test('keeps the order of the file without a query and puts the best match first with one', () => {
        const entries = entriesOf(SYMBOLS);
        expect(filterEntries(entries, '').map((entry) => entry.name)).toEqual(['DEFAULT_WEIGHTS', 'Scorer', 'score', 'scoreCandidate']);
        expect(filterEntries(entries, 'score').map((entry) => entry.name)).toEqual(['Scorer', 'score', 'scoreCandidate']);
        expect(filterEntries(entries, 'candidate').map((entry) => entry.name)).toEqual(['scoreCandidate']);
    });
});

describe('the input', () => {
    test('reads # as the project, : as a line and the rest as a filter', () => {
        expect(modeOf('score')).toEqual({ mode: 'symbol', text: 'score' });
        expect(modeOf('# Foo ')).toEqual({ mode: 'workspace', text: 'Foo' });
        expect(modeOf(':42')).toEqual({ mode: 'line', line: 42 });
        expect(modeOf(':x')).toEqual({ mode: 'line', line: null });
    });

    test('turns the symbols of the project into places', () => {
        expect(workspaceEntriesOf([{ name: 'Foo', kind: 5, containerName: 'App', location: { uri: 'file:///a.ts', range: range(4) } }])).toEqual([
            { id: '0', name: 'Foo', kind: 5, container: 'App', uri: 'file:///a.ts', line: 4 }
        ]);
        expect(workspaceEntriesOf(null)).toEqual([]);
    });
});
