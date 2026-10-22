import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, PanelTop, Sheet, Table } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { CodeFile } from '@/shell/panels/CodeFile';
import { DELIMITERS, delimiterOf, type Delimiter } from '@/shell/panels/delimited';
import { useFileActions } from '@/shell/panels/file-actions';
import { FileTextMenu, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { useFiles } from '@/state/files';
import { useEndpointId } from '@/state/keys';
import { useUnsaved } from '@/state/text-drafts';
import { ButtonGroup, EmptyState, ErrorBoundary, lazyNamed, LazyBoundary, Menu } from '@adecore/ui';

// The grid comes with the database views, which most workspaces never open, so it waits for the first table.
const TableGrid = lazyNamed(() => import('@/shell/panels/TableGrid'), 'TableGrid');

type TableView = 'table' | 'source';

const DELIMITER_NAMES = {
    ',': 'file.table.delimiters.comma',
    ';': 'file.table.delimiters.semicolon',
    '\t': 'file.table.delimiters.tab'
} as const satisfies Record<Delimiter, string>;

/*
 * A `.csv` or `.tsv` file as a table, with the source a click away and editable. The table reads
 * what is on disk, so unsaved changes keep the file in the editor, the way a markdown preview does.
 */
export function TableFile({ path, name, read }: { path: string; name: string; read: FsReadText }) {
    const { t } = useTranslation('panels');
    const tabKey = useFileActions()?.tabKey ?? null;
    const reveal = useFiles((state) => (state.revealLine?.key === tabKey ? state.revealLine : null));
    const [dismissedReveal, setDismissedReveal] = useState<number | null>(null);
    const [chosen, setView] = useState<TableView>('table');
    const [header, setHeader] = useState(true);
    const [picked, setPicked] = useState<Delimiter | null>(null);
    const unsaved = useUnsaved(useEndpointId(), path);
    const view = unsaved || (reveal != null && reveal.nonce !== dismissedReveal) ? 'source' : chosen;
    const detected = delimiterOf(name, read.text);
    const delimiter = picked ?? detected;
    const blank = read.text.replace(/^﻿/, '').trim() === '';

    const toggle = (
        <ButtonGroup>
            <FileToolbarToggle
                icon={Table}
                label={unsaved ? t('file.view.tableAfterSave') : t('file.view.table')}
                active={view === 'table'}
                disabled={unsaved}
                onClick={() => {
                    setDismissedReveal(reveal?.nonce ?? null);
                    setView('table');
                }}
            />
            <FileToolbarToggle icon={Code} label={t('file.view.source')} active={view === 'source'} onClick={() => setView('source')} />
        </ButtonGroup>
    );

    if (view === 'source') {
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
                <FileTextMenu className="grid min-h-0 grow place-items-center overflow-auto">
                    <EmptyState icon={Sheet}>{t('file.table.empty', { name })}</EmptyState>
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
