import { EmptyState, ErrorBoundary, lazyNamed, LazyBoundary, Menu, ScrollArea } from '@adecore/ui';
import type { FsReadText } from '@ruimte/contracts';
import { PanelTop, Sheet, Table } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '@/files/CodeFile';
import { DELIMITERS, delimiterOf, type Delimiter } from '@/files/delimited';
import { FileTextMenu, FileToolbar, FileToolbarToggle } from '@/files/FileToolbar';
import { useSourceToggle } from '@/files/use-source-toggle';

// The grid comes with the database views, which most workspaces never open, so it waits for the first table.
const TableGrid = lazyNamed(() => import('@/files/TableGrid'), 'TableGrid');

const DELIMITER_NAMES = {
    ',': 'file.table.delimiters.comma',
    ';': 'file.table.delimiters.semicolon',
    '\t': 'file.table.delimiters.tab'
} as const satisfies Record<Delimiter, string>;

/* A `.csv` or `.tsv` file as a table, with the source a click away and editable. */
export function TableFile({ path, name, read }: { path: string; name: string; read: FsReadText }) {
    const { t } = useTranslation('panels');
    const { source, toggle } = useSourceToggle(path, Table, { label: t('file.view.table'), afterSave: t('file.view.tableAfterSave') });
    const [header, setHeader] = useState(true);
    const [picked, setPicked] = useState<Delimiter | null>(null);
    const delimiter = picked ?? delimiterOf(name, read.text);
    const blank = read.text.replace(/^﻿/, '').trim() === '';

    if (source) {
        return <CodeFile path={path} read={read} toolbarExtra={toggle} />;
    }
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar
                menu={
                    <Menu.Group>
                        <Menu.GroupLabel>{t('file.table.delimiter')}</Menu.GroupLabel>
                        <Menu.RadioGroup value={delimiter} onValueChange={(value: Delimiter) => setPicked(value)}>
                            {DELIMITERS.map((option) => (
                                <Menu.RadioItem key={option} value={option}>
                                    {t(DELIMITER_NAMES[option])}
                                </Menu.RadioItem>
                            ))}
                        </Menu.RadioGroup>
                    </Menu.Group>
                }
            >
                <FileToolbarToggle icon={PanelTop} label={t('file.table.header')} active={header} onClick={() => setHeader(!header)} />
                {toggle}
            </FileToolbar>
            {blank ? (
                <FileTextMenu className="flex min-h-0 grow flex-col">
                    <ScrollArea className="grow" viewportClassName="grid place-items-center">
                        <EmptyState icon={Sheet}>{t('file.table.empty', { name })}</EmptyState>
                    </ScrollArea>
                </FileTextMenu>
            ) : (
                <ErrorBoundary label={t('file.table.crashed')} resetKeys={[path, read.mtime]} className="flex min-h-0 grow flex-col">
                    <LazyBoundary>
                        <TableGrid path={path} name={name} read={read} header={header} delimiter={delimiter} delimiterName={t(DELIMITER_NAMES[delimiter])} />
                    </LazyBoundary>
                </ErrorBoundary>
            )}
        </div>
    );
}
