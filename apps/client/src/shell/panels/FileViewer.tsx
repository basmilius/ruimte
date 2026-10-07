import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DiffFile } from '@/shell/panels/DiffFile';
import { FileBody } from '@/shell/panels/FileBody';
import { fixedSlot, FileToolbarSlotProvider, useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { keptTabs, shownAfter } from '@/shell/panels/kept-tabs';
import { ErrorBoundary, lazyNamed } from '@adecore/ui';
import { basenameOf } from '@/shell/panels/files-tree';
import { isDatabaseTab, useFiles, type Tab } from '@/state/files';

const DatabaseTabBody = lazyNamed(() => import('@/database/DatabaseTabBody'), 'DatabaseTabBody');

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
 * The body of a host's loose views: whichever tab is up. The tabs shown last keep their editor underneath,
 * hidden and inert, as the platform keeps an editor per tab: going back to one finds its colors, folds and
 * usages as they were, instead of the editor building them up again in front of you. A table with edits
 * nobody submitted stays drawn however long ago it was up, or the edits would go with it. `ids` are the
 * views of the cell in order, of which the loose ones are tabs.
 */
export function FileViewer({ active, ids }: { active: string; ids: readonly string[] }) {
    const { t } = useTranslation('databases');
    const pool = useFiles((s) => s.tabs);
    const unsubmitted = useFiles((s) => s.unsubmitted);
    const [shown, setShown] = useState<readonly string[]>([]);
    if (shown[0] !== active) {
        setShown(shownAfter(shown, active));
    }

    const tabs = useMemo(() => ids.flatMap((id): Tab[] => pool.filter((entry) => entry.key === id)), [ids, pool]);
    if (!tabs.some((entry) => entry.key === active)) {
        return null;
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
