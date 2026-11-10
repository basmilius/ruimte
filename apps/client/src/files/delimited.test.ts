import { describe, expect, test } from 'bun:test';
import type { GridColumn, GridRow, GridSort } from '@adecore/database';
import { columnKindOf, delimiterOf, detectDelimiter, findCells, parseDelimited, sortRows, tableOf } from './delimited';

const columnName = (position: number): string => `Column ${position}`;

describe('parseDelimited', () => {
    test('splits records on the delimiter and on any line break', () => {
        expect(parseDelimited('a,b\r\nc,d\ne,f\rg,h', ',')).toEqual({
            records: [
                ['a', 'b'],
                ['c', 'd'],
                ['e', 'f'],
                ['g', 'h']
            ],
            malformed: false
        });
    });

    test('a line break at the end ends the last record and starts none', () => {
        expect(parseDelimited('a,b\n', ',').records).toEqual([['a', 'b']]);
        expect(parseDelimited('a,b\r\n', ',').records).toEqual([['a', 'b']]);
    });

    test('a blank line in the middle is a record of one empty field', () => {
        expect(parseDelimited('a\n\nb\n', ',').records).toEqual([['a'], [''], ['b']]);
    });

    test('quoted fields hold delimiters, line breaks and doubled quotes', () => {
        const text = 'name,note\n"Smith, J.","He said ""hi""\nand left"\n';
        expect(parseDelimited(text, ',')).toEqual({
            records: [
                ['name', 'note'],
                ['Smith, J.', 'He said "hi"\nand left']
            ],
            malformed: false
        });
    });

    test('empty fields, quoted or not, and a delimiter at the end of a record', () => {
        expect(parseDelimited('a,,"",\n', ',').records).toEqual([['a', '', '', '']]);
    });

    test('drops a byte order mark', () => {
        expect(parseDelimited('﻿id;name\n1;x', ';').records).toEqual([
            ['id', 'name'],
            ['1', 'x']
        ]);
        expect(parseDelimited('﻿', ',').records).toEqual([]);
    });

    test('an empty text has no records', () => {
        expect(parseDelimited('', ',')).toEqual({ records: [], malformed: false });
    });

    test('a quote inside an unquoted field is text', () => {
        expect(parseDelimited('5" pipe,x', ',')).toEqual({ records: [['5" pipe', 'x']], malformed: false });
    });

    test('a quote that never closes reads to the end and says so', () => {
        expect(parseDelimited('a,"b\nc,d\n', ',')).toEqual({ records: [['a', 'b\nc,d\n']], malformed: true });
    });

    test('text after a closing quote is kept and says so', () => {
        expect(parseDelimited('"a"b,c\n', ',')).toEqual({ records: [['ab', 'c']], malformed: true });
    });

    test('tabs split a tab separated text', () => {
        expect(parseDelimited('a\tb,c\n', '\t').records).toEqual([['a', 'b,c']]);
    });
});

describe('detectDelimiter', () => {
    test('a semicolon export with decimal commas', () => {
        expect(detectDelimiter('naam;prijs\nkoffie;2,50\nthee;1,75\n')).toBe(';');
    });

    test('a comma, with semicolons and commas inside quotes ignored', () => {
        expect(detectDelimiter('a,b\n"x;y;z",1\n"p;q",2\n')).toBe(',');
    });

    test('a tab', () => {
        expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    });

    test('a single column falls back to a comma', () => {
        expect(detectDelimiter('one\ntwo\n')).toBe(',');
    });

    test('a line break inside quotes does not end a line', () => {
        expect(detectDelimiter('a;b\n"x\ny";1\n')).toBe(';');
    });

    test('a .tsv is tab separated whatever it holds', () => {
        expect(delimiterOf('data.tsv', 'a,b\n1,2\n')).toBe('\t');
        expect(delimiterOf('data.csv', 'a;b\n1;2\n')).toBe(';');
    });
});

describe('columnKindOf', () => {
    const kindOf = (...values: string[]): string =>
        columnKindOf(
            values.map((value) => [value]),
            0
        );

    test('whole numbers are integers, blanks aside', () => {
        expect(kindOf('1', '-20', '', '+3')).toBe('integer');
    });

    test('numbers with one decimal mark are decimals', () => {
        expect(kindOf('1', '2.5', '1e3')).toBe('decimal');
        expect(kindOf('1', '2,5', ',5')).toBe('decimal');
    });

    test('two decimal marks in one column, or any other text, is text', () => {
        expect(kindOf('1.5', '2,5')).toBe('text');
        expect(kindOf('1', 'n/a')).toBe('text');
        expect(kindOf('1.000.000')).toBe('text');
    });

    test('a column with nothing in it is text', () => {
        expect(kindOf('', ' ')).toBe('text');
    });
});

describe('tableOf', () => {
    const records = [['city', 'population'], ['Utrecht', '374238', 'extra'], ['Zwolle']];

    test('pads ragged records to the widest and names the columns past the header', () => {
        const table = tableOf(records, true, columnName);
        expect(table.columns).toEqual([
            { name: 'city', type: '', kind: 'text' },
            { name: 'population', type: '', kind: 'integer' },
            { name: 'Column 3', type: '', kind: 'text' }
        ]);
        expect(table.rows).toEqual([
            { key: '1', number: 1, cells: ['Utrecht', '374238', 'extra'] },
            { key: '2', number: 2, cells: ['Zwolle', '', ''] }
        ]);
    });

    test('without a header every record is a row, and a row keeps its key', () => {
        const table = tableOf(records, false, columnName);
        expect(table.columns.map((column) => column.name)).toEqual(['Column 1', 'Column 2', 'Column 3']);
        expect(table.rows.map((row) => [row.key, row.number])).toEqual([
            ['0', 1],
            ['1', 2],
            ['2', 3]
        ]);
    });

    test('names a blank header and keeps names apart', () => {
        const table = tableOf([['id', '', 'id', 'Column 2']], true, columnName);
        expect(table.columns.map((column) => column.name)).toEqual(['id', 'Column 2', 'id (2)', 'Column 2 (2)']);
        expect(table.rows).toEqual([]);
    });
});

describe('sortRows', () => {
    const columns: GridColumn[] = [
        { name: 'name', type: '', kind: 'text' },
        { name: 'amount', type: '', kind: 'decimal' }
    ];
    const row = (key: string, name: string, amount: string): GridRow => ({ key, number: Number(key), cells: [name, amount] });
    const rows = [row('1', 'file10', '10,5'), row('2', 'file2', ''), row('3', 'File1', '9'), row('4', 'file2', '-1')];
    const keysOf = (sorts: GridSort[]): string[] => sortRows(rows, columns, sorts).map((entry) => entry.key);

    test('numbers by value, blanks last either way', () => {
        expect(keysOf([{ column: 'amount', direction: 'asc' }])).toEqual(['4', '3', '1', '2']);
        expect(keysOf([{ column: 'amount', direction: 'desc' }])).toEqual(['1', '3', '4', '2']);
    });

    test('text with numbers in it the way a person counts, case aside', () => {
        expect(keysOf([{ column: 'name', direction: 'asc' }])).toEqual(['3', '2', '4', '1']);
    });

    test('a second sort breaks the ties of the first', () => {
        expect(
            keysOf([
                { column: 'name', direction: 'asc' },
                { column: 'amount', direction: 'asc' }
            ])
        ).toEqual(['3', '4', '2', '1']);
    });

    test('no sorts, or only unknown columns, keep the file order', () => {
        expect(sortRows(rows, columns, [])).toBe(rows);
        expect(keysOf([{ column: 'gone', direction: 'asc' }])).toEqual(['1', '2', '3', '4']);
    });
});

describe('findCells', () => {
    test('every cell the pattern matches, row by row', () => {
        const rows: GridRow[] = [
            { key: 'a', number: 1, cells: ['Utrecht', 'utrecht'] },
            { key: 'b', number: 2, cells: ['Zwolle', ''] }
        ];
        expect(findCells(rows, /utrecht|zwolle/giu)).toEqual([
            { rowKey: 'a', column: 0 },
            { rowKey: 'a', column: 1 },
            { rowKey: 'b', column: 0 }
        ]);
    });
});
