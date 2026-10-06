import type { Cell, ResultColumn, RowsResult, ValueKind } from '@adecore/database/protocol';

const NUMERIC: ReadonlySet<ValueKind> = new Set(['integer', 'decimal', 'float']);

/* The tallest the table scrolls in before the header sticks; the frame then fits the page without a scroll of its own. */
const TABLE_MAX_HEIGHT = 480;

const STYLE = [
    '.rows{max-height:' + TABLE_MAX_HEIGHT + 'px;overflow:auto;scrollbar-width:thin}',
    'table{border-collapse:separate;border-spacing:0;min-width:100%;font-size:13px;font-variant-numeric:tabular-nums}',
    'th,td{padding:5px 12px 5px 0;text-align:left;white-space:nowrap;max-width:28em;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid var(--border)}',
    'th{position:sticky;top:0;z-index:1;background:var(--background);color:var(--muted-foreground);font-weight:600}',
    'tbody tr:last-child td{border-bottom:none}',
    '.number{text-align:right}',
    '.quiet{color:var(--muted-foreground)}',
    '.null{color:var(--muted-foreground);font-style:italic}',
    'p{margin:8px 0 0;color:var(--muted-foreground);font-size:12px}'
].join('\n');

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/* A binary value that fits the cell limit arrives as its hex alone, without the length a cut one carries. */
export function binarySize(cell: { hex: string }): number {
    const { length } = cell as { length?: number };
    return length ?? cell.hex.length / 2;
}

function td(classes: readonly string[], text: string): string {
    return `<td${classes.length === 0 ? '' : ` class="${classes.join(' ')}"`}>${text}</td>`;
}

function cellHtml(cell: Cell, numeric: boolean): string {
    const align = numeric ? ['number'] : [];
    if (cell === null) {
        return td(['null', ...align], 'NULL');
    }
    if (typeof cell !== 'object') {
        return td(align, escapeHtml(String(cell)));
    }
    if (cell.kind === 'binary') {
        return td(['quiet', ...align], `${binarySize(cell)} bytes of binary`);
    }
    return td(align, `${escapeHtml(cell.preview)}…`);
}

function headerHtml(column: ResultColumn): string {
    return `<th${NUMERIC.has(column.kind) ? ' class="number"' : ''}>${escapeHtml(column.name)}</th>`;
}

/* Where the rows came from, so a person who asked about two databases knows which this is. */
export interface TableSource {
    connection: string;
    schema: string | null;
}

function captionOf(result: RowsResult, source: TableSource): string {
    const count = result.rows.length === 1 ? '1 row' : `${result.rows.length} rows`;
    const from = source.schema === null ? source.connection : `${source.schema} on ${source.connection}`;
    return `${count} from ${from}${result.hasMore ? ', and more in the database' : ''}`;
}

/*
 * A query's rows as a visual: a compact table on the thread's own background with a header that
 * stays while the rows scroll, numbers right-aligned by the kind of their column and NULL drawn
 * quieter. Every name and value is escaped, since they are whatever the database holds.
 */
export function tableVisual(result: RowsResult, source: TableSource): string {
    const numeric = result.columns.map((column) => NUMERIC.has(column.kind));
    const rows = result.rows.map((row) => `<tr>${row.map((cell, index) => cellHtml(cell, numeric[index] === true)).join('')}</tr>`);
    return [
        '<!doctype html>',
        '<meta charset="utf-8">',
        `<style>\n${STYLE}\n</style>`,
        '<div class="rows"><table>',
        `<thead><tr>${result.columns.map(headerHtml).join('')}</tr></thead>`,
        `<tbody>\n${rows.join('\n')}\n</tbody>`,
        '</table></div>',
        `<p>${escapeHtml(captionOf(result, source))}</p>`
    ].join('\n');
}
