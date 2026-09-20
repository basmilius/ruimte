import { describe, expect, test } from 'bun:test';
import { groupCards, searchCards, type FlowCardRow } from '@/flow/card-search';

const row = (over: Partial<FlowCardRow> & Pick<FlowCardRow, 'kind' | 'label'>): FlowCardRow => ({
    source: 'Flow',
    sentence: '',
    ...over
});

const ROWS: FlowCardRow[] = [
    row({ kind: 'trigger', card: 'time.at', label: 'On a time', source: 'Time', sentence: 'on a time' }),
    row({ kind: 'trigger', card: 'files.changed', label: 'A file changed', source: 'Files', sentence: '… changed' }),
    row({ kind: 'condition', card: 'text.contains', label: 'Text contains', source: 'Text', sentence: 'text contains something' }),
    row({ kind: 'action', card: 'person.notify', label: 'Show a notification', source: 'You', sentence: 'show …' }),
    row({ kind: 'delay', label: 'Wait', sentence: 'wait … seconds' })
];

const labels = (found: readonly FlowCardRow[]): string[] => found.map((entry) => entry.label);

describe('searching the cards', () => {
    test('an empty query offers every row, in the order it was handed', () => {
        expect(labels(searchCards(ROWS, '   '))).toEqual(labels(ROWS));
    });

    test('a word is looked for whatever the case it was typed in', () => {
        expect(labels(searchCards(ROWS, 'FILE'))).toEqual(['A file changed']);
    });

    test('every word of the query has to be somewhere in the row', () => {
        expect(labels(searchCards(ROWS, 'file changed'))).toEqual(['A file changed']);
        expect(labels(searchCards(ROWS, 'file notification'))).toEqual([]);
    });

    test('a word that only the sentence holds still finds the card', () => {
        expect(labels(searchCards(ROWS, 'seconds'))).toEqual(['Wait']);
    });

    test('the source is searched as well', () => {
        expect(labels(searchCards(ROWS, 'you'))).toEqual(['Show a notification']);
    });

    test('a card named after the query comes before one that only says it', () => {
        const rows = [
            row({ kind: 'action', card: 'chat.message', label: 'Send a message to a chat', source: 'Chat', sentence: 'send … once the turn is done' }),
            row({ kind: 'trigger', card: 'chat.finished', label: 'A chat is done', source: 'Chat', sentence: 'a chat finished a turn' })
        ];
        expect(labels(searchCards(rows, 'done'))).toEqual(['A chat is done', 'Send a message to a chat']);
    });

    test('a query nothing answers comes back empty rather than as everything', () => {
        expect(searchCards(ROWS, 'zeppelin')).toEqual([]);
    });
});

describe('grouping the cards', () => {
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

    test('the sources read in the order of their words, with the built-in cards last', () => {
        const groups = groupCards(ROWS, 'The graph itself', collator);
        expect(groups.map((group) => group.heading)).toEqual(['Files', 'Text', 'Time', 'You', 'The graph itself']);
        expect(labels(groups[0]?.rows ?? [])).toEqual(['A file changed']);
        expect(labels(groups.at(-1)?.rows ?? [])).toEqual(['Wait']);
    });

    test('the cards of one source stay together, in the order they came in', () => {
        const rows = [
            row({ kind: 'trigger', card: 'time.at', label: 'On a time', source: 'Time' }),
            row({ kind: 'action', card: 'person.notify', label: 'Show a notification', source: 'You' }),
            row({ kind: 'condition', card: 'time.between', label: 'Between two times', source: 'Time' })
        ];
        const groups = groupCards(rows, 'The graph itself', collator);
        expect(groups.map((group) => group.heading)).toEqual(['Time', 'You']);
        expect(labels(groups[0]?.rows ?? [])).toEqual(['On a time', 'Between two times']);
    });

    test('without a card of its own the built-in group is left out', () => {
        const groups = groupCards([ROWS[0] as FlowCardRow], 'The graph itself', collator);
        expect(groups.map((group) => group.heading)).toEqual(['Time']);
    });

    test('the interface language decides the order of the headings', () => {
        const rows = [
            row({ kind: 'trigger', card: 'files.changed', label: 'Een bestand veranderde', source: 'Bestanden' }),
            row({ kind: 'trigger', card: 'time.at', label: 'Op een tijdstip', source: 'Tijd' }),
            row({ kind: 'action', card: 'person.notify', label: 'Toon een melding', source: 'Jij' })
        ];
        const dutch = groupCards(rows, 'Over de graaf zelf', new Intl.Collator('nl', { sensitivity: 'base', numeric: true }));
        expect(dutch.map((group) => group.heading)).toEqual(['Bestanden', 'Jij', 'Tijd']);
    });
});
