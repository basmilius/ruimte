import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { ExternalLink, X } from 'lucide-react';
import { Markdown } from '@/chat/ui/Markdown';
import { formatDay, formatDayWithYear } from '@/format/datetime';
import { UpdateAction } from '@/shell/settings/panes/AboutPane';
import { closeReleaseNotes, missingNotesNotice, notesView, RELEASES_PAGE, useReleaseNotes, type NoteEntry } from '@/state/release-notes';
import { useUpdates } from '@/state/updates';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';

const dateOf = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.getFullYear() === new Date().getFullYear() ? formatDay(date) : formatDayWithYear(date);
};

function ReleaseEntry({ entry }: { entry: NoteEntry }) {
    const { t } = useTranslation('shell');
    const { release } = entry;
    return (
        <section data-version={release.version} className="border-b border-border px-5 py-4 last:border-b-0">
            <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text">{t('connection.version', { version: release.version })}</h3>
                {entry.badge && <Pill className={entry.role === 'upcoming' ? 'text-accent' : undefined}>{entry.badge}</Pill>}
                {entry.isNew && <Pill className="text-positive">{t('releaseNotes.new')}</Pill>}
                <span className="grow" />
                <span className="text-xs text-text-muted">{dateOf(release.publishedAt)}</span>
                {release.compareUrl && (
                    <a className="text-xs text-text-muted hover:text-text hover:underline" href={release.compareUrl} target="_blank" rel="noreferrer">
                        {t('releaseNotes.compare')}
                    </a>
                )}
            </header>
            <div className="release-notes mt-1">
                {release.body === '' ? (
                    <p className="mt-2 text-xs text-text-muted">{t('releaseNotes.noNotes')}</p>
                ) : (
                    <Markdown text={release.body} fileLinks={false} />
                )}
            </div>
        </section>
    );
}

/*
 * The notes of the last releases, newest first, opened from About or from the toast after an update.
 * Mounted once beside the toasts rather than inside the settings, so the toast can open it on its
 * own; the nested classes still put it over the settings when those are open.
 */
export function ReleaseNotesDialog() {
    const { t } = useTranslation('shell');
    const open = useReleaseNotes((s) => s.open);
    const version = useReleaseNotes((s) => s.version);
    const notes = useReleaseNotes((s) => s.notes);
    const loading = useReleaseNotes((s) => s.loading);
    const previousSeen = useReleaseNotes((s) => s.previousSeen);
    const updates = useUpdates();
    const listRef = useRef<HTMLDivElement>(null);
    const scrolledFor = useRef<string | null>(null);

    const releases = notes?.releases ?? [];
    const view = notesView(releases, updates.currentVersion, updates, previousSeen);
    const missing = missingNotesNotice(releases, version, loading);
    const listed = version !== null && releases.some((release) => release.version === version);

    useEffect(() => {
        if (!open) {
            scrolledFor.current = null;
            return;
        }
        const list = listRef.current;
        if (!list || !listed || scrolledFor.current === version) {
            return;
        }
        const target = list.querySelector<HTMLElement>(`[data-version="${version}"]`);
        if (target) {
            list.scrollTop = target.offsetTop;
            scrolledFor.current = version;
        }
    }, [open, version, listed]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : closeReleaseNotes())}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop dialog-backdrop-nested" forceRender />
                <Dialog.Popup
                    className="dialog-popup dialog-popup-nested flex h-[min(640px,80vh)] w-[520px] flex-col"
                    onKeyDown={(e) => {
                        // Every open dialog root listens for Escape on the document, and this one is not
                        // nested in the settings' tree, so without this one press would close both.
                        if (e.key === 'Escape') {
                            e.stopPropagation();
                            closeReleaseNotes();
                        }
                    }}
                >
                    <div className="flex items-center gap-4 border-b border-border px-5 py-4">
                        <Dialog.Title className="grow text-base font-semibold text-text">{t('releaseNotes.title')}</Dialog.Title>
                        <Dialog.Close className="icon-btn h-7 w-7" aria-label={t('releaseNotes.close')}>
                            <Icon icon={X} size={16} />
                        </Dialog.Close>
                    </div>
                    <div ref={listRef} className="relative min-h-0 grow overflow-y-auto">
                        <ErrorBoundary label={t('releaseNotes.failed')} resetKeys={[notes]}>
                            {missing && (
                                <p className="border-b border-border px-5 py-3 text-xs text-text-muted">
                                    {missing.text}.{' '}
                                    <a className="text-accent hover:underline" href={missing.url} target="_blank" rel="noreferrer">
                                        {t('releaseNotes.viewOnGitHub')}
                                    </a>
                                </p>
                            )}
                            {releases.length === 0 && notes?.error && (
                                <p className="px-5 py-3 text-xs text-text-muted">
                                    {t('releaseNotes.loadFailed', { reason: notes.error })}{' '}
                                    <a className="text-accent hover:underline" href={RELEASES_PAGE} target="_blank" rel="noreferrer">
                                        {t('releaseNotes.openOnGitHub')}
                                    </a>
                                </p>
                            )}
                            {releases.length === 0 && !notes?.error && loading && (
                                <p className="px-5 py-3 text-xs text-text-muted">{t('releaseNotes.loading')}</p>
                            )}
                            {view.entries.map((entry) => (
                                <ReleaseEntry key={entry.release.version} entry={entry} />
                            ))}
                        </ErrorBoundary>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                        <Button variant="ghost" href={RELEASES_PAGE}>
                            {t('releaseNotes.allReleases')} <Icon icon={ExternalLink} size={12} />
                        </Button>
                        <span className="grow" />
                        {updates.supported && <UpdateAction />}
                    </div>
                    <Dialog.Description className="sr-only">{t('releaseNotes.dialogDescription')}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
