import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import type { FileTreeVisibleRow } from '@pierre/trees';
import { FileArchive, FileWarning, MousePointerClick, PackageOpen } from 'lucide-react';
import { absoluteOf, type ArchiveEntry, type ArchiveFormat, type ArchiveListResult, type FsReadBinary } from '@ruimte/contracts';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { saveBlob } from '@/download';
import { ArchiveEntryItems, ArchiveEntryPreview, type ArchiveVersion } from '@/shell/panels/ArchiveEntryPreview';
import { archiveTotals, archiveTreePaths, entryPathOf, extractFolderName, freeFolderName, isFolderName, isFolderRow } from '@/shell/panels/archive-tree';
import { FileTextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { basenameOf, dirnameOf } from '@/shell/panels/files-tree';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { readResource } from '@/transport/byte-transfer';
import { useTransport } from '@/transport/context';
import { readPiece } from '@/transport/piece';
import type { Transport } from '@/transport/transport';
import {
    Button,
    ColumnResizeHandle,
    ContextMenu,
    EmptyState,
    ErrorBoundary,
    FileTree,
    Icon,
    IconButton,
    Menu,
    PromptDialog,
    useColumnResize,
    useFileTree
} from '@adecore/ui';
import { formatBytes, formatNumber } from '@adecore/ui/format';

const { rowPathOf } = FileTree;

type Listing = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; list: ArchiveListResult };

const LOADING: Listing = { status: 'loading' };

// Names of formats, the way their tools write them; not words, so not translated.
const FORMAT_NAMES: Record<ArchiveFormat, string> = { zip: 'ZIP', tar: 'TAR', 'tar-gzip': 'TAR.GZ', gzip: 'GZIP' };

// Room for a name and its size, and never more than half the view, as the tree of a patch has.
const MIN_TREE_WIDTH = 180;
const DEFAULT_TREE_WIDTH = 280;

// Up to this many entries the tree opens with every folder unfolded; past it, a person unfolds what they look for.
const OPEN_TREE_ENTRIES = 200;

/* What an extract takes: everything, or the entries a person picked, named for the dialog's title. */
interface ExtractTarget {
    entries?: string[];
    label: string;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/* The entries as the files panel draws files, with each file's size after its name. */
function ArchiveTree({
    entries,
    label,
    onPick,
    onSave,
    onExtract
}: {
    entries: readonly ArchiveEntry[];
    label: string;
    onPick(path: string | null): void;
    onSave(entry: ArchiveEntry): void;
    onExtract(target: ExtractTarget): void;
}) {
    const { t } = useTranslation('panels');
    const [menuPath, setMenuPath] = useState<string | null>(null);
    const onPickRef = useRef(onPick);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const { model } = useFileTree({
        paths: [],
        flattenEmptyDirectories: true,
        initialExpansion: entries.length <= OPEN_TREE_ENTRIES ? 'open' : 'closed',
        onSelectionChange: (paths) => {
            const path = paths.length === 1 ? paths[0]! : null;
            onPickRef.current(path === null || isFolderRow(path) ? null : path);
        }
    });

    useEffect(() => {
        onPickRef.current = onPick;
    }, [onPick]);

    useLayoutEffect(() => {
        model.resetPaths(archiveTreePaths(entries));
    }, [entries, model]);

    const decorate = (row: FileTreeVisibleRow) => {
        const entry = row.kind === 'directory' ? undefined : byPath.get(row.path);
        return entry === undefined ? null : (
            <FileTree.Decoration className="text-xs text-text-faint tabular-nums">{formatBytes(entry.size)}</FileTree.Decoration>
        );
    };

    const menuEntry = menuPath === null || isFolderRow(menuPath) ? undefined : byPath.get(menuPath);
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                className="flex min-h-0 grow flex-col overflow-hidden"
                onContextMenu={(event) => {
                    const path = rowPathOf(event);
                    if (path === null) {
                        event.preventBaseUIHandler();
                        return;
                    }
                    setMenuPath(path);
                }}
            >
                <FileTree.Root model={model} className="min-h-0 grow overflow-hidden" label={label} renderDecoration={decorate} />
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {menuPath !== null && isFolderRow(menuPath) && (
                    <Menu.Item onClick={() => onExtract({ entries: [entryPathOf(menuPath)], label: basenameOf(entryPathOf(menuPath)) })}>
                        <Icon icon={PackageOpen} size={14} /> {t('file.archive.menu.extractFolder')}
                    </Menu.Item>
                )}
                {menuEntry !== undefined && (
                    <ArchiveEntryItems
                        entry={menuEntry}
                        onSave={() => onSave(menuEntry)}
                        onExtract={() => onExtract({ entries: [menuEntry.path], label: basenameOf(menuEntry.path) })}
                    />
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/*
 * Where an extract lands: a new folder beside the archive, named after it unless that name is taken or
 * the person names it otherwise. The folder that results is revealed in the files panel.
 */
function ExtractDialog({ path, target, onClose }: { path: string; target: ExtractTarget | null; onClose(): void }) {
    const { t } = useTranslation('panels');
    const transport = useTransport();
    const projectId = useProject((s) => s.current?.projectId);
    const folder = dirnameOf(path);
    const named = extractFolderName(basenameOf(path));
    const [free, setFree] = useState<{ folder: string; name: string } | null>(null);
    const open = target !== null;

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        transport
            .request('fs.list', { path: folder, hidden: true })
            .then((listed) => {
                if (!cancelled) {
                    setFree({ folder, name: freeFolderName(named, new Set(listed.entries.map((entry) => entry.name))) });
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open, transport, folder, named]);

    const confirm = async (value: string): Promise<void> => {
        if (target === null) {
            return;
        }
        if (!isFolderName(value)) {
            throw new Error(t('file.archive.extract.badName'));
        }
        const to = absoluteOf(folder, value);
        const result = await transport.request('archive.extract', {
            path,
            to,
            ...(target.entries === undefined ? {} : { entries: target.entries }),
            ...(projectId === undefined ? {} : { projectId })
        });
        onClose();
        void perform('file.reveal', { path: result.to }).catch(ignoreRefusal);
        useToasts.getState().show({
            kind: 'success',
            title: t('file.archive.extract.done', { count: result.files, folder: basenameOf(result.to) }),
            ...(result.skippedTotal === 0 ? {} : { description: t('file.archive.extract.skipped', { count: result.skippedTotal }) })
        });
    };

    return (
        <PromptDialog
            open={open}
            title={t('file.archive.extract.title', { name: target?.label ?? basenameOf(path) })}
            description={t('file.archive.extract.description', { folder })}
            field={{ label: t('file.archive.extract.folderName'), initial: free !== null && free.folder === folder ? free.name : named }}
            confirmLabel={t('file.archive.extract.confirm')}
            confirmBusyLabel={t('file.archive.extract.busy')}
            confirmIcon={PackageOpen}
            onConfirm={confirm}
            onOpenChange={onClose}
        />
    );
}

async function saveEntry(transport: Transport, path: string, entry: ArchiveEntry): Promise<void> {
    const name = basenameOf(entry.path);
    try {
        const blob = await readResource((piece) => readPiece(transport, piece), { kind: 'file', path, entry: entry.path });
        await saveBlob(blob, name, blob.type === '' ? 'application/octet-stream' : blob.type);
    } catch (e) {
        const message = messageOf(e);
        useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.archive.saveFailed', { name }), description: message, output: message });
    }
}

/*
 * An archive as a tree of what it holds beside a preview of the entry picked, with the archive's own
 * bar above both. The machine lists it, unpacks an entry when it is picked and extracts into the project;
 * nothing here ever writes into the archive.
 */
export function ArchiveFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const transport = useTransport();
    const key = JSON.stringify([path, read.mtime, read.size]);
    const [held, setHeld] = useState<{ key: string; listing: Listing } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [picked, setPicked] = useState<{ key: string; path: string } | null>(null);
    const [extracting, setExtracting] = useState<ExtractTarget | null>(null);
    const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
    const bodyRef = useRef<HTMLDivElement>(null);
    const treeRef = useRef<HTMLElement>(null);
    const listing = held !== null && held.key === key ? held.listing : LOADING;
    const archive: ArchiveVersion = { path, mtime: read.mtime, size: read.size };
    const { startResize } = useColumnResize(treeRef, {
        size: treeWidth,
        min: MIN_TREE_WIDTH,
        from: 'left',
        max: () => Math.floor((bodyRef.current?.getBoundingClientRect().width ?? 0) / 2),
        onSize: setTreeWidth
    });

    useEffect(() => {
        let cancelled = false;
        transport.request('archive.list', { path }).then(
            (list) => !cancelled && setHeld({ key, listing: { status: 'ready', list } }),
            (e: unknown) => !cancelled && setHeld({ key, listing: { status: 'failed', message: messageOf(e) } })
        );
        return () => {
            cancelled = true;
        };
    }, [transport, path, key, attempt]);

    const entries = listing.status === 'ready' ? listing.list.entries : null;
    const byPath = new Map((entries ?? []).map((entry) => [entry.path, entry]));
    const totals = entries === null ? null : archiveTotals(entries);
    const selected = picked !== null && picked.key === key ? byPath.get(picked.path) : undefined;
    const pick = (treePath: string | null) => setPicked(treePath === null ? null : { key, path: entryPathOf(treePath) });
    const save = (entry: ArchiveEntry) => void saveEntry(transport, path, entry);

    const retry = (): void => {
        setHeld(null);
        setAttempt((count) => count + 1);
    };

    const centered = (content: ReactNode): ReactNode => <FileTextMenu className="grid min-h-0 grow place-items-center overflow-auto">{content}</FileTextMenu>;

    const body = (): ReactNode => {
        if (listing.status === 'loading') {
            return centered(<EmptyState busy>{t('file.archive.listing', { name })}</EmptyState>);
        }
        if (listing.status === 'failed') {
            return centered(
                <EmptyState
                    className="select-text"
                    icon={FileWarning}
                    action={
                        <Button variant="secondary" size="sm" onClick={retry}>
                            {t('common:action.retry')}
                        </Button>
                    }
                >
                    {t('file.archive.failed', { name, reason: listing.message })}
                </EmptyState>
            );
        }
        const list = listing.list;
        if (list.entries.length === 0) {
            return centered(<EmptyState icon={FileArchive}>{t('file.archive.empty', { name })}</EmptyState>);
        }
        return (
            <>
                {(list.truncated || list.unsafe > 0) && (
                    <div className="flex shrink-0 flex-col gap-0.5 border-b border-border bg-surface px-3 py-1.5 text-xs text-text-muted select-text">
                        {list.truncated && <span>{t('file.archive.truncated', { value: formatNumber(list.entries.length) })}</span>}
                        {list.unsafe > 0 && <span>{t('file.archive.unsafe', { count: list.unsafe })}</span>}
                    </div>
                )}
                <div ref={bodyRef} className="@container flex min-h-0 grow flex-col">
                    <div className="flex min-h-0 grow flex-col @xl:flex-row">
                        <aside
                            ref={treeRef}
                            className="relative flex h-60 max-h-1/2 min-h-0 shrink-0 flex-col border-b border-border bg-surface @xl:h-auto @xl:max-h-none @xl:w-(--archive-tree-width) @xl:max-w-1/2 @xl:border-r @xl:border-b-0"
                            style={{ '--archive-tree-width': `${treeWidth}px` } as CSSProperties}
                        >
                            <div className="flex min-h-0 grow flex-col overflow-hidden py-1">
                                <ArchiveTree
                                    entries={list.entries}
                                    label={t('file.archive.tree', { name })}
                                    onPick={pick}
                                    onSave={save}
                                    onExtract={setExtracting}
                                />
                            </div>
                            <ColumnResizeHandle from="left" className="hidden @xl:block" onPointerDown={startResize} />
                        </aside>
                        <div className="flex min-h-0 min-w-0 grow flex-col">
                            {selected === undefined ? (
                                centered(<EmptyState icon={MousePointerClick}>{t('file.archive.pick')}</EmptyState>)
                            ) : (
                                <ErrorBoundary label={t('file.archive.crashed')} resetKeys={[selected.path]} className="min-h-0 grow">
                                    <ArchiveEntryPreview
                                        key={selected.path}
                                        archive={archive}
                                        entry={selected}
                                        onSave={() => save(selected)}
                                        onExtract={() => setExtracting({ entries: [selected.path], label: basenameOf(selected.path) })}
                                    />
                                </ErrorBoundary>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                <IconButton
                    icon={PackageOpen}
                    size="sm"
                    label={t('file.archive.extractAll')}
                    disabled={entries === null || entries.length === 0}
                    onClick={() => setExtracting({ label: name })}
                />
            </FileToolbar>
            {body()}
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                {listing.status === 'ready' && totals !== null && (
                    <>
                        <span>{FORMAT_NAMES[listing.list.format]}</span>
                        <span>{t('file.archive.files', { count: totals.files, value: formatNumber(totals.files) })}</span>
                        <span>{t('file.archive.unpacked', { size: formatBytes(totals.size) })}</span>
                        {listing.list.format !== 'tar' && <span>{t('file.archive.packed', { size: formatBytes(totals.compressed ?? read.size) })}</span>}
                    </>
                )}
                {listing.status !== 'ready' && <span>{formatBytes(read.size)}</span>}
            </div>
            <ExtractDialog path={path} target={extracting} onClose={() => setExtracting(null)} />
        </div>
    );
}
