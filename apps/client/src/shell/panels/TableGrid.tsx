import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FsReadText } from '@ruimte/contracts';
import { DataGrid, type DataGridProps, type GridLayout, type GridSort } from '@adecore/database';
import { compileFind, stepIndex } from '@adecore/editor-react/models';
import { formatBytes, formatNumber } from '@adecore/ui/format';
import { FindBar } from '@/find/FindBar';
import { useFind } from '@/find/use-find';
import { findCells, parseDelimited, sortRows, tableOf, type CellMatch, type Delimiter } from '@/shell/panels/delimited';
import { EditorNotice } from '@/shell/panels/DraftBar';

const NO_SORTS: readonly GridSort[] = [];

// What a person did to the columns of a file, kept while the app runs so a tab opened again looks the same.
const layouts = new Map<string, GridLayout>();

interface TableGridProps {
    path: string;
    name: string;
    read: FsReadText;
    header: boolean;
    delimiter: Delimiter;
    delimiterName: string;
}

/*
 * The rows of a delimited file on the database views' grid. Find searches the cells and puts the grid's
 * focus on each match in turn, since the grid draws only the rows in view and a find over the page would
 * miss the rest.
 */
export function TableGrid({ path, name, read, header, delimiter, delimiterName }: TableGridProps) {
    const { t } = useTranslation('panels');
    const [sorts, setSorts] = useState<readonly GridSort[]>(NO_SORTS);
    const surface = useRef<HTMLDivElement>(null);
    const find = useFind(surface);
    const [picked, setPicked] = useState<{ matches: readonly CellMatch[]; index: number } | null>(null);

    const parsed = parseDelimited(read.text, delimiter);
    const table = tableOf(parsed.records, header, (position) => t('file.table.column', { position }));
    const rows = sortRows(table.rows, table.columns, sorts);

    const compiled = compileFind(find.query);
    const pattern = find.open && compiled.kind === 'pattern' ? compiled.pattern : null;
    const matches = pattern === null ? [] : findCells(rows, pattern);
    // A new set of matches, from a query typed or rows sorted, starts at the first one.
    const current = matches.length === 0 ? null : picked?.matches === matches ? picked.index : 0;
    const focusRequest: DataGridProps['focusRequest'] = current === null ? null : { ...matches[current]!, quiet: true };

    const step = (direction: 1 | -1): void => {
        const index = stepIndex(current, matches.length, direction);
        if (index !== null) {
            setPicked({ matches, index });
        }
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {parsed.malformed && <EditorNotice message={t('file.table.malformed')} />}
            <div ref={surface} className="relative flex min-h-0 min-w-0 grow flex-col">
                {find.open && <FindBar find={find} total={matches.length} current={current} invalid={compiled.kind === 'invalid'} onStep={step} />}
                <DataGrid
                    label={name}
                    columns={table.columns}
                    rows={rows}
                    sorts={sorts}
                    onSortsChange={setSorts}
                    initialLayout={layouts.get(path)}
                    onLayoutChange={(layout) => layouts.set(path, layout)}
                    focusRequest={focusRequest}
                    empty={t('file.table.noRows', { name })}
                />
            </div>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                <span>{t('file.table.rows', { count: table.rows.length, value: formatNumber(table.rows.length) })}</span>
                <span>{t('file.table.columns', { count: table.columns.length, value: formatNumber(table.columns.length) })}</span>
                <span>{delimiterName}</span>
                <span>{formatBytes(read.size)}</span>
            </div>
        </div>
    );
}
