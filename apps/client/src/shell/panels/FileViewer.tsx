import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { runAsPerson } from '@/actions/client-actions';
import { FileText, Search } from 'lucide-react';
import { openDatabaseTab } from '@/database/open';
import { databaseTabIcon, databaseTabTitle } from '@/database/tab-look';
import { reopenAction } from '@/database/tabs';
import { DiffFile } from '@/shell/panels/DiffFile';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { FileBody } from '@/shell/panels/FileBody';
import { fixedSlot, FileToolbarSlotProvider, useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { keptTabs, shownAfter } from '@/shell/panels/kept-tabs';
import { FileIcon, EmptyState, ErrorBoundary, Icon, lazyNamed, ListRow, SectionLabel, Tile, ContextMenu } from '@adecore/ui';
import { basenameOf } from '@/shell/panels/files-tree';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { isDatabaseTab, useFiles, type DatabaseTab } from '@/state/files';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';

const DatabaseTabBody = lazyNamed(() => import('@/database/DatabaseTabBody'), 'DatabaseTabBody');

const RECENT_ROW = 'min-w-0 gap-2 text-left text-sm text-text hover:bg-surface-hover';

/* A database view closed a moment ago, opened again the way it stood. */
function RecentDatabaseTab({ tab }: { tab: DatabaseTab }) {
    const action = reopenAction(tab);
    return (
        <ListRow
            variant="inset"
            render={<button type="button" />}
            className={RECENT_ROW}
            onClick={() => {
                if (action !== null) {
                    openDatabaseTab(action);
                }
            }}
        >
            <Icon icon={databaseTabIcon(tab)} size={14} className="shrink-0 text-text-faint" />
            <span className="min-w-0 truncate">{databaseTabTitle(tab)}</span>
        </ListRow>
    );
}

/* The preview with no tab up: a file to open, a search through the folder, and what was closed a moment ago. */
function EmptyPreview() {
    const { t } = useTranslation('panels');
    const folder = useProject((s) => s.current?.folder ?? null);
    const recent = useFiles((s) => s.recent);
    if (folder === null && recent.length === 0) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={FileText}>{t('file.empty.hint')}</EmptyState>
            </div>
        );
    }
    return (
        <div className="grid min-h-0 grow place-items-center overflow-auto">
            <div className="flex w-full max-w-xs flex-col gap-4 px-4 py-6">
                {folder !== null && (
                    <div className="flex flex-col gap-1.5">
                        <Tile
                            size="sm"
                            icon={<Icon icon={FileText} size={14} />}
                            title={t('file.empty.openFile')}
                            onClick={() => useUi.getState().openFilePicker({ kind: 'tab' })}
                        />
                        <Tile
                            size="sm"
                            icon={<Icon icon={Search} size={14} />}
                            title={t('file.empty.findInFiles')}
                            shortcut={APP_SHORTCUTS.findInFiles}
                            onClick={() => useUi.getState().openFindInFiles()}
                        />
                    </div>
                )}
                {recent.length > 0 && (
                    <section className="flex flex-col gap-1">
                        <SectionLabel render={<h2 />} className="px-2">
                            {t('file.empty.recent')}
                        </SectionLabel>
                        {recent.map((closed) =>
                            closed.kind === 'file' ? (
                                <ContextMenu.Root key={closed.path}>
                                    <ContextMenu.Trigger
                                        render={<ListRow variant="inset" render={<button type="button" />} />}
                                        className={RECENT_ROW}
                                        onClick={() => void runAsPerson('file.preview', { path: closed.path, line: null })}
                                    >
                                        <FileIcon path={closed.path} size={14} />
                                        <span className="min-w-0 truncate">{basenameOf(closed.path)}</span>
                                    </ContextMenu.Trigger>
                                    {/* Closed, so no tab to name: the items a preview tab offers about its file. */}
                                    <ContextMenu.Popup>
                                        <FileActionItems path={closed.path} on="tab" />
                                    </ContextMenu.Popup>
                                </ContextMenu.Root>
                            ) : (
                                <RecentDatabaseTab key={closed.key} tab={closed} />
                            )
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

/*
 * One tab the viewer keeps drawn. One that is not up is invisible and inert, and its controls go into a
 * place of their own rather than the bar of the cell, which only the tab up may fill.
 */
function KeptTab({ up, children }: { up: boolean; children: ReactNode }) {
    const slot = useFileToolbarSlot();
    const [parked, setParked] = useState<HTMLElement | null>(null);
    const parkedSlot = useMemo(() => fixedSlot(parked), [parked]);
    return (
        <div className={`absolute inset-0 flex min-h-0 min-w-0 flex-col justify-center ${up ? '' : 'invisible'}`} inert={!up}>
            <span ref={setParked} hidden className="hidden" />
            <FileToolbarSlotProvider value={up ? slot : parkedSlot}>{children}</FileToolbarSlotProvider>
        </div>
    );
}

/*
 * The preview panel's body: whichever tab is up, under the strip that names them. The tabs shown last keep
 * their editor underneath, hidden and inert, as the platform keeps an editor per tab: going back to one finds
 * its colors, folds and usages as they were, instead of the editor building them up again in front of you. A
 * table with edits nobody submitted stays drawn however long ago it was up, or the edits would go with it.
 */
export function FileViewer() {
    const { t } = useTranslation('databases');
    const active = useFiles((s) => s.active);
    const tabs = useFiles((s) => s.tabs);
    const unsubmitted = useFiles((s) => s.unsubmitted);
    const [shown, setShown] = useState<readonly string[]>([]);
    if (active && shown[0] !== active) {
        setShown(shownAfter(shown, active));
    }

    const tab = tabs.find((entry) => entry.key === active) ?? null;
    if (!active || !tab) {
        return <EmptyPreview />;
    }
    const kept = keptTabs(active, shown, tabs, undefined, (entry) => unsubmitted[entry.key] === true);

    return (
        // Keyed on the tab, so a tab starts a read of its own instead of drawing the file before it.
        <div className="relative min-h-0 min-w-0 grow">
            {kept.map((entry) => (
                <KeptTab key={entry.key} up={entry.key === active}>
                    {isDatabaseTab(entry) ? (
                        <ErrorBoundary label={t('tab.failed')} resetKeys={[entry.key]} className="h-full">
                            <Suspense fallback={null}>
                                <DatabaseTabBody tab={entry} />
                            </Suspense>
                        </ErrorBoundary>
                    ) : entry.view ? (
                        <DiffFile key={entry.key} tabKey={entry.key} path={entry.path} name={basenameOf(entry.path)} view={entry.view} />
                    ) : (
                        <FileBody key={entry.key} path={entry.path} name={basenameOf(entry.path)} on="tab" tabKey={entry.key} />
                    )}
                </KeptTab>
            ))}
        </div>
    );
}
