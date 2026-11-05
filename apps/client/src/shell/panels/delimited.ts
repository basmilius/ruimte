import type { GridColumn, GridRow, GridSort } from '@adecore/database';
import { labelCollator } from '@adecore/ui/format';
import { extensionOf } from '@/surface/panels/file-kind';

export type Delimiter = ',' | ';' | '\t';

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

interface DelimitedRecords {
    records: string[][];
    /* A quote that never closed, or text right after a closing quote; what follows is read as well as it goes. */
    malformed: boolean;
}

type ColumnKind = 'text' | 'integer' | 'decimal';

interface DelimitedTable {
    columns: GridColumn[];
    rows: GridRow[];
}

const BOM = 0xfeff;
const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;

// Enough lines to tell a delimiter apart from the odd one in a value, without reading a large file twice.
const SAMPLE_LINES = 20;
const SAMPLE_CHARS = 64 * 1024;

const INTEGER = /^[+-]?\d+$/;
const DECIMAL_POINT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
// Spreadsheets in a region that writes 3,14 export it that way, next to a `;` delimiter.
const DECIMAL_COMMA = /^[+-]?(?:\d+(?:,\d*)?|,\d+)$/;

function fieldEnd(text: string, from: number, separator: number): number {
    for (let index = from; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === separator || code === LF || code === CR) {
            return index;
        }
    }
    return text.length;
}

/*
 * The records of a delimited text, after RFC 4180: a quoted field holds delimiters, line breaks and
 * doubled quotes. Any of CRLF, LF and CR ends a record, and a line break at the very end ends the last
 * one rather than starting another. A quote inside an unquoted field is kept as text.
 */
export function parseDelimited(text: string, delimiter: Delimiter): DelimitedRecords {
    const separator = delimiter.charCodeAt(0);
    const records: string[][] = [];
    let malformed = false;
    let position = text.charCodeAt(0) === BOM ? 1 : 0;
    if (position >= text.length) {
        return { records, malformed };
    }
    let record: string[] = [];
    while (true) {
        if (text.charCodeAt(position) === QUOTE) {
            let value = '';
            let from = position + 1;
            while (true) {
                const quote = text.indexOf('"', from);
                if (quote < 0) {
                    value += text.slice(from);
                    position = text.length;
                    malformed = true;
                    break;
                }
                value += text.slice(from, quote);
                if (text.charCodeAt(quote + 1) === QUOTE) {
                    value += '"';
                    from = quote + 2;
                    continue;
                }
                position = quote + 1;
                const stop = fieldEnd(text, position, separator);
                if (stop > position) {
                    malformed = true;
                    value += text.slice(position, stop);
                    position = stop;
                }
                break;
            }
            record.push(value);
        } else {
            const stop = fieldEnd(text, position, separator);
            record.push(text.slice(position, stop));
            position = stop;
        }
        if (position >= text.length) {
            records.push(record);
            break;
        }
        const code = text.charCodeAt(position);
        if (code === separator) {
            position += 1;
            if (position >= text.length) {
                record.push('');
                records.push(record);
                break;
            }
            continue;
        }
        position += code === CR && text.charCodeAt(position + 1) === LF ? 2 : 1;
        records.push(record);
        record = [];
        if (position >= text.length) {
            break;
        }
    }
    return { records, malformed };
}

/*
 * The delimiter of a `.csv`: of a comma, a semicolon and a tab, the one each of the first lines holds
 * equally often, counted outside quotes. Without such a one, the one seen most; without any, a comma.
 */
export function detectDelimiter(text: string): Delimiter {
    const lines: number[][] = [];
    let counts = [0, 0, 0];
    let seen = false;
    let quoted = false;
    const end = Math.min(text.length, SAMPLE_CHARS);
    for (let index = 0; index < end && lines.length < SAMPLE_LINES; index++) {
        const code = text.charCodeAt(index);
        if (code === QUOTE) {
            quoted = !quoted;
        } else if (!quoted && (code === LF || code === CR)) {
            if (seen) {
                lines.push(counts);
            }
            counts = [0, 0, 0];
            seen = false;
            continue;
        } else if (!quoted) {
            const candidate = DELIMITERS.indexOf(text[index] as Delimiter);
            if (candidate >= 0) {
                counts[candidate]! += 1;
            }
        }
        seen = true;
    }
    // A line the sample cut off counts too few, unless it is the last line of the text.
    if (seen && end === text.length) {
        lines.push(counts);
    }
    let best: { delimiter: Delimiter; consistent: boolean; score: number } | null = null;
    for (let candidate = 0; candidate < DELIMITERS.length; candidate++) {
        const perLine = lines.map((line) => line[candidate]!);
        const total = perLine.reduce((sum, count) => sum + count, 0);
        if (total === 0) {
            continue;
        }
        const consistent = perLine.every((count) => count === perLine[0]);
        const score = consistent ? perLine[0]! : total;
        if (best === null || (consistent && !best.consistent) || (consistent === best.consistent && score > best.score)) {
            best = { delimiter: DELIMITERS[candidate]!, consistent, score };
        }
    }
    return best?.delimiter ?? ',';
}

/* A `.tsv` is tab separated by its name; a `.csv` says which by its text. */
export function delimiterOf(name: string, text: string): Delimiter {
    return extensionOf(name) === 'tsv' ? '\t' : detectDelimiter(text);
}

/* A number column when every value that is not blank is a whole number, or a decimal written with one and the same mark. */
export function columnKindOf(records: readonly (readonly string[])[], column: number): ColumnKind {
    let integer = true;
    let point = true;
    let comma = true;
    let filled = false;
    for (const record of records) {
        const value = record[column]?.trim() ?? '';
        if (value === '') {
            continue;
        }
        filled = true;
        integer &&= INTEGER.test(value);
        point &&= DECIMAL_POINT.test(value);
        comma &&= DECIMAL_COMMA.test(value);
        if (!point && !comma) {
            return 'text';
        }
    }
    if (!filled) {
        return 'text';
    }
    return integer ? 'integer' : 'decimal';
}

// Sorting and the grid's layout find a column by its name, so two columns never share one.
function uniqueName(name: string, taken: Set<string>): string {
    let unique = name;
    for (let count = 2; taken.has(unique); count++) {
        unique = `${name} (${count})`;
    }
    taken.add(unique);
    return unique;
}

/*
 * The records as the grid's columns and rows, padded to the widest record. A column without a name in
 * the header, or every column when there is no header, is named by `generatedName` from its position.
 * A row's key is its record's index in the file, so a row keeps its key when the header is turned off.
 */
export function tableOf(records: readonly (readonly string[])[], header: boolean, generatedName: (position: number) => string): DelimitedTable {
    const width = records.reduce((widest, record) => Math.max(widest, record.length), 0);
    const names = header ? (records[0] ?? []) : [];
    const body = header ? records.slice(1) : records;
    const taken = new Set<string>();
    const columns = Array.from({ length: width }, (_, index): GridColumn => {
        const named = names[index] ?? '';
        return {
            name: uniqueName(named.trim() === '' ? generatedName(index + 1) : named, taken),
            type: '',
            kind: columnKindOf(body, index)
        };
    });
    const rows = body.map((record, index): GridRow => ({
        key: String(header ? index + 1 : index),
        number: index + 1,
        cells: record.length === width ? record : [...record, ...Array.from({ length: width - record.length }, () => '')]
    }));
    return { columns, rows };
}

type SortValue = string | number | null;

function sortValueOf(cell: unknown, numeric: boolean): SortValue {
    const text = typeof cell === 'string' ? cell.trim() : '';
    if (text === '') {
        return null;
    }
    return numeric ? Number(text.replace(',', '.')) : text;
}

/* The rows in the order of `sorts`, numbers by value and text the way the language sorts it, with blank cells last either way. */
export function sortRows(rows: readonly GridRow[], columns: readonly GridColumn[], sorts: readonly GridSort[]): readonly GridRow[] {
    const keys = sorts.flatMap((sort) => {
        const index = columns.findIndex((column) => column.name === sort.column);
        return index < 0 ? [] : [{ index, numeric: columns[index]!.kind !== 'text', sign: sort.direction === 'asc' ? 1 : -1 }];
    });
    if (keys.length === 0) {
        return rows;
    }
    const collator = labelCollator();
    const decorated = rows.map((row) => ({ row, values: keys.map((key) => sortValueOf(row.cells[key.index], key.numeric)) }));
    decorated.sort((left, right) => {
        for (let index = 0; index < keys.length; index++) {
            const first = left.values[index]!;
            const second = right.values[index]!;
            if (first === null || second === null) {
                if (first !== second) {
                    return first === null ? 1 : -1;
                }
                continue;
            }
            const order = typeof first === 'number' && typeof second === 'number' ? first - second : collator.compare(String(first), String(second));
            if (order !== 0) {
                return order * keys[index]!.sign;
            }
        }
        return 0;
    });
    return decorated.map((entry) => entry.row);
}

export interface CellMatch {
    rowKey: string;
    column: number;
}

/* The cells whose text `pattern` matches, row by row in the order given and left to right within a row. */
export function findCells(rows: readonly GridRow[], pattern: RegExp): CellMatch[] {
    // A global pattern carries `lastIndex` from one test to the next.
    const once = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    const matches: CellMatch[] = [];
    for (const row of rows) {
        row.cells.forEach((cell, column) => {
            if (typeof cell === 'string' && cell !== '' && once.test(cell)) {
                matches.push({ rowKey: row.key, column });
            }
        });
    }
    return matches;
}
