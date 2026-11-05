import { Button, EmptyState, Icon, Menu, messageOf, ScrollArea } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES, isArchiveMime, type ArchiveEntry, type FsReadBinary } from '@ruimte/contracts';
import { Download, FileArchive, FileLock, FileQuestion, FileWarning, Link2, PackageOpen, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { canSaveEntry, hasArchiveName } from '@/shell/panels/archive-tree';
import { CodeText } from '@/shell/panels/CodeFile';
import { FileActionsContext, FileMenuRowsContext } from '@/shell/panels/file-actions';
import type { FileSource } from '@/shell/panels/file-source';
import { fixedSlot, FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { basenameOf } from '@/shell/panels/files-tree';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { renderBinary } from '@/shell/panels/renderers';
import { readPiece } from '@/transport-api/piece';
import { TransportError } from '@/transport-api/transport';
import { readResource } from '@/transport/byte-transfer';
import { useTransport } from '@/transport/context';

export interface ArchiveVersion {
    path: string;
    mtime: number;
    size: number;
}

type Probe =
    | { status: 'reading' }
    | { status: 'failed'; message: string }
    | { status: 'too-large' }
    | { status: 'not-readable' }
    | { status: 'nested' }
    | { status: 'text'; text: string; language?: string }
    | { status: 'binary'; mime: string; size: number };

const READING: Probe = { status: 'reading' };

// The bar the preview draws stays in the preview, under the archive's own, and acts on the entry alone.
const OWN_BAR = fixedSlot(null);

/* What can be told from the listing alone, before a byte of the entry is asked for. */
function knownBefore(entry: ArchiveEntry): Probe | null {
    if (entry.kind === 'symlink' || !entry.readable) {
        return { status: 'not-readable' };
    }
    if (entry.size > BYTES_READ_MAX_BYTES) {
        return { status: 'too-large' };
    }
    return hasArchiveName(entry.path) ? { status: 'nested' } : null;
}

/* The rows of an entry's menus: what can be done with an entry, and none of what is done to a file on disk. */
export function ArchiveEntryItems({ entry, onSave, onExtract }: { entry: ArchiveEntry; onSave(): void; onExtract(): void }) {
    const { t } = useTranslation('panels');
    return (
        <>
            <Menu.Item disabled={!canSaveEntry(entry)} onClick={onSave}>
                <Icon icon={Download} size={14} /> {t('file.archive.menu.saveAs')}
            </Menu.Item>
            <Menu.Item onClick={onExtract}>
                <Icon icon={PackageOpen} size={14} /> {t('file.archive.menu.extract')}
            </Menu.Item>
        </>
    );
}

/*
 * One entry of an archive, drawn by the renderer a file of its kind gets. The machine unpacks it and
 * says what its bytes are; text shows highlighted and read only, and an entry never offers anything
 * that would write it, reveal it or rename it, since it is no file on disk.
 */
export function ArchiveEntryPreview({
    archive,
    entry,
    onSave,
    onExtract
}: {
    archive: ArchiveVersion;
    entry: ArchiveEntry;
    onSave(): void;
    onExtract(): void;
}) {
    const { t } = useTranslation('panels');
    const transport = useTransport();
    const name = basenameOf(entry.path);
    const before = knownBefore(entry);
    const key = JSON.stringify([archive.path, archive.mtime, archive.size, entry.path]);
    const [held, setHeld] = useState<{ key: string; probe: Probe } | null>(null);
    const probe = before ?? (held !== null && held.key === key ? held.probe : READING);
    const known = before !== null;

    useEffect(() => {
        if (known) {
            return;
        }
        let cancelled = false;
        const resource = { kind: 'file' as const, path: archive.path, entry: entry.path };
        const settle = (next: Probe): void => {
            if (!cancelled) {
                setHeld({ key, probe: next });
            }
        };
        readPiece(transport, { resource, offset: 0, length: BYTES_CHUNK_MAX })
            .then(async (first): Promise<Probe> => {
                if (first.mime.startsWith('text/plain')) {
                    const bytes =
                        first.size <= first.bytes.length
                            ? first.bytes
                            : new Uint8Array(await (await readResource((piece) => readPiece(transport, piece), resource)).arrayBuffer());
                    return {
                        status: 'text',
                        text: new TextDecoder('utf-8').decode(bytes),
                        ...(first.language === undefined ? {} : { language: first.language })
                    };
                }
                return isArchiveMime(first.mime) ? { status: 'nested' } : { status: 'binary', mime: first.mime, size: first.size };
            })
            .then(settle, (e: unknown) => {
                if (e instanceof TransportError && e.code === 'entry-too-large') {
                    settle({ status: 'too-large' });
                } else if (e instanceof TransportError && e.code === 'not-readable') {
                    settle({ status: 'not-readable' });
                } else {
                    settle({ status: 'failed', message: messageOf(e) });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [known, transport, archive.path, entry.path, key]);

    const extractAction = (
        <Button variant="secondary" size="sm" onClick={onExtract}>
            <Icon icon={PackageOpen} size={14} /> {t('file.archive.menu.extract')}
        </Button>
    );

    const state = (icon: LucideIcon | undefined, text: string, action?: ReactNode, busy = false): ReactNode => (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <FileTextMenu className="flex min-h-0 grow flex-col">
                <ScrollArea className="grow" viewportClassName="grid place-items-center">
                    <EmptyState className="select-text" icon={icon} busy={busy} action={action}>
                        {text}
                    </EmptyState>
                </ScrollArea>
            </FileTextMenu>
        </div>
    );

    const body = (): ReactNode => {
        if (probe.status === 'reading') {
            return state(undefined, t('file.archive.entry.reading', { name }), undefined, true);
        }
        if (probe.status === 'failed') {
            return state(FileWarning, t('file.archive.entry.failed', { name, reason: probe.message }));
        }
        if (probe.status === 'not-readable') {
            return entry.kind === 'symlink'
                ? state(Link2, t('file.archive.entry.link', { name }))
                : state(FileLock, t('file.archive.entry.notReadable', { name }));
        }
        if (probe.status === 'too-large') {
            return state(
                FileArchive,
                t('file.archive.entry.tooLarge', { name, size: formatBytes(entry.size), limit: formatBytes(BYTES_READ_MAX_BYTES) }),
                extractAction
            );
        }
        if (probe.status === 'nested') {
            return state(FileArchive, t('file.archive.entry.nested', { name }), extractAction);
        }
        if (probe.status === 'text') {
            return (
                <div className="flex min-h-0 min-w-0 grow flex-col">
                    <FileToolbar />
                    <CodeText text={probe.text} language={probe.language} />
                </div>
            );
        }
        const source: FileSource = { kind: 'archive-entry', path: archive.path, entry: entry.path, archiveMtime: archive.mtime, archiveSize: archive.size };
        const read: FsReadBinary = { kind: 'binary', mime: probe.mime, size: probe.size, mtime: entry.mtime ?? archive.mtime };
        return (
            renderBinary(source, name, read) ??
            state(
                FileQuestion,
                t('file.archive.entry.cannotShow', { name, mime: probe.mime, size: formatBytes(probe.size) }),
                <Button variant="secondary" size="sm" onClick={onSave}>
                    <Icon icon={Download} size={14} /> {t('file.archive.menu.saveAs')}
                </Button>
            )
        );
    };

    return (
        <FileToolbarSlotProvider value={OWN_BAR}>
            <FileActionsContext.Provider value={null}>
                <FileMenuRowsContext.Provider value={<ArchiveEntryItems entry={entry} onSave={onSave} onExtract={onExtract} />}>
                    {body()}
                </FileMenuRowsContext.Provider>
            </FileActionsContext.Provider>
        </FileToolbarSlotProvider>
    );
}
