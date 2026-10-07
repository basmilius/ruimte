import { memo, useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilRuler, SquareTerminal, Table, TableProperties, Unplug, type LucideIcon } from 'lucide-react';
import type { DatabaseConnection } from '@ruimte/contracts';
import { QueryConsole, StructureView, TableDesigner, TableView } from '@adecore/database';
import { Button, EmptyState, ErrorBoundary, Icon, IconButton, PromptDialog, Tabs } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import {
    asViewConnections,
    ensureDatabaseConnections,
    useDatabaseConnectionList,
    useDatabaseConnections,
    type ConnectionsStatus
} from '@/database/connections';
import { DatabaseTabProvider, RuimteDatabaseProvider } from '@/database/RuimteDatabaseProvider';
import { openNewConsole, useDatabaseTabs } from '@/database/state';
import type { DatabaseTab } from '@/database/tabs';

const ICONS: Record<DatabaseTab['kind'], LucideIcon> = {
    table: Table,
    structure: TableProperties,
    console: SquareTerminal,
    designer: PencilRuler
};

/*
 * A key a view answered never reaches the window's shortcuts: the console's Run all is the grid's
 * maximize, and a grid's own copy or select all is nothing the canvas behind it should hear. The
 * views say they answered by preventing the default, so only those keys stop here.
 */
function keepAnsweredKeys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented) {
        event.stopPropagation();
    }
}

/* The tables, consoles and designers this client has open, as tabs. Tabs in the back stay mounted, so edits nobody submitted survive a look elsewhere. */
export function DatabasesCell() {
    const { t } = useTranslation('databases');
    const tabs = useDatabaseTabs((state) => state.tabs);
    const active = useDatabaseTabs((state) => state.active);
    const closing = useDatabaseTabs((state) => state.closing);
    const focusRequest = useDatabaseTabs((state) => state.focusRequest);
    const connections = useDatabaseConnectionList();
    const status = useDatabaseConnections((state) => state.status);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => ensureDatabaseConnections(), []);

    useEffect(() => {
        if (focusRequest === 0) {
            return;
        }
        // A frame later: the palette that opened the tab is still closing and hands the focus back on its way out. A console that took the caret keeps it.
        const frame = requestAnimationFrame(() => {
            if (root.current !== null && !root.current.contains(document.activeElement)) {
                root.current.focus();
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [focusRequest]);

    const titleOf = (tab: DatabaseTab): string => {
        switch (tab.kind) {
            case 'table':
                return tab.where === undefined ? tab.table : t('tab.filtered', { table: tab.table });
            case 'structure':
                return t('tab.structure', { table: tab.table });
            case 'console':
                return t('tab.console', { number: formatNumber(tab.number) });
            case 'designer':
                return tab.table === undefined ? t('tab.newTable') : t('tab.design', { table: tab.table });
        }
    };

    const closingTab = tabs.find((tab) => tab.id === closing);

    return (
        <div ref={root} tabIndex={-1} className="flex min-h-0 grow flex-col outline-none" onKeyDown={keepAnsweredKeys}>
            <RuimteDatabaseProvider>
                <Tabs.Root value={active} onValueChange={(id) => useDatabaseTabs.getState().activate(String(id))} className="flex min-h-0 grow flex-col">
                    <Tabs.List
                        aria-label={t('cell.tabs')}
                        className="shrink-0 px-2"
                        end={
                            <IconButton
                                icon={SquareTerminal}
                                size="sm"
                                label={t('cell.newConsole')}
                                disabled={connections.length === 0}
                                onClick={() => void openNewConsole()}
                            />
                        }
                    >
                        {tabs.map((tab) => (
                            <Tabs.Tab key={tab.id} value={tab.id} onClose={() => useDatabaseTabs.getState().requestClose(tab.id)}>
                                <Icon icon={ICONS[tab.kind]} size={14} />
                                {titleOf(tab)}
                            </Tabs.Tab>
                        ))}
                    </Tabs.List>
                    {tabs.length === 0 ? (
                        <EmptyState
                            icon={SquareTerminal}
                            title={t('cell.empty.title')}
                            className="grow"
                            action={
                                <Button variant="secondary" disabled={connections.length === 0} onClick={() => void openNewConsole()}>
                                    {t('cell.newConsole')}
                                </Button>
                            }
                        >
                            {t('cell.empty.body')}
                        </EmptyState>
                    ) : (
                        tabs.map((tab) => (
                            <Tabs.Panel key={tab.id} value={tab.id} keepMounted className="min-h-0 grow">
                                <ErrorBoundary label={t('cell.failed')} resetKeys={[tab.id]} className="h-full">
                                    <TabBody tab={tab} connections={connections} status={status} />
                                </ErrorBoundary>
                            </Tabs.Panel>
                        ))
                    )}
                </Tabs.Root>
            </RuimteDatabaseProvider>
            <PromptDialog
                open={closingTab !== undefined}
                danger
                title={t('cell.discard.title', { table: closingTab?.kind === 'table' ? closingTab.table : '' })}
                description={t('cell.discard.description')}
                confirmLabel={t('cell.discard.confirm')}
                onConfirm={() => useDatabaseTabs.getState().confirmClose()}
                onOpenChange={(open) => {
                    if (!open) {
                        useDatabaseTabs.getState().cancelClose();
                    }
                }}
            />
        </div>
    );
}

/*
 * One tab's view on its connection, inside a provider that answers for this tab, so a designer that saved
 * a table can turn its own tab into that table's designer. Memoized, since every keystroke in a console is a new
 * list of tabs and a grid in the back has no reason to draw again for it.
 */
const TabBody = memo(function TabBody({
    tab,
    connections,
    status
}: {
    tab: DatabaseTab;
    connections: readonly DatabaseConnection[];
    status: ConnectionsStatus;
}) {
    const { t } = useTranslation('databases');
    const opened = useDatabaseTabs((state) => state.opened);
    const found = connections.find((connection) => connection.id === tab.connectionId);

    if (found === undefined) {
        // While the list is read a tab cannot know yet whether its connection is still there.
        return status === 'ready' ? (
            <EmptyState
                icon={Unplug}
                className="h-full"
                action={
                    <Button size="sm" variant="secondary" onClick={() => useDatabaseTabs.getState().requestClose(tab.id)}>
                        {t('cell.closeTab')}
                    </Button>
                }
            >
                {t('cell.gone')}
            </EmptyState>
        ) : null;
    }
    const [connection] = asViewConnections([found]);
    if (connection === undefined) {
        return null;
    }

    return (
        <DatabaseTabProvider tabId={tab.id}>
            {tab.kind === 'table' && (
                <TableView
                    connection={connection}
                    schema={tab.schema}
                    table={tab.table}
                    defaultWhere={tab.where}
                    onDirtyChange={(dirty) => useDatabaseTabs.getState().setDirty(tab.id, dirty)}
                    className="h-full"
                />
            )}
            {tab.kind === 'structure' && <StructureView connection={connection} schema={tab.schema} table={tab.table} className="h-full" />}
            {tab.kind === 'console' && (
                <QueryConsole
                    connection={connection}
                    schema={tab.schema}
                    value={tab.sql}
                    onValueChange={(sql) => useDatabaseTabs.getState().setConsoleSql(tab.id, sql)}
                    autoFocus={opened === tab.id}
                    className="h-full"
                />
            )}
            {tab.kind === 'designer' && <TableDesigner connection={connection} schema={tab.schema} table={tab.table} className="h-full" />}
        </DatabaseTabProvider>
    );
});
