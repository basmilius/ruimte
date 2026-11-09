import { Button, FormError, Icon, Input, messageOf, ScrollArea } from '@adecore/ui';
import type { FsBrowseResult } from '@ruimte/contracts';
import { ArrowLeft, CornerLeftUp, Folder, FolderCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endsWithSeparator, parentOf, separatorFor, shownPath } from '@/paths/machine-path';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport/index';

/*
 * The folders of another machine, one level at a time, for the checkout that is none of its projects
 * yet. The palette's browser opens a folder as a project of the machine the window is on; this only
 * names a folder on the other one.
 */
export function RemoteFolderPicker({
    endpointId,
    machine,
    onPick,
    onBack
}: {
    endpointId: string;
    machine: string;
    onPick(folder: string): void;
    onBack(): void;
}) {
    const { t } = useTranslation('shell');
    const platform = useServers((s) => s.byEndpoint[endpointId]?.platform ?? null);
    const sep = separatorFor(platform);
    const [path, setPath] = useState(`~${sep}`);
    const [listing, setListing] = useState<FsBrowseResult | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    useEffect(() => {
        let current = true;
        transportFor(endpointId)
            ?.request('fs.browse', { partialPath: path })
            .then(
                (answer) => {
                    if (current) {
                        setListing(answer);
                        setFailure(null);
                        // The machine's own way of writing its home folder replaces the tilde once it has said which it is.
                        setPath(shownPath(path, answer.parentPath, platform));
                    }
                },
                (e: unknown) => {
                    if (current) {
                        setFailure(messageOf(e));
                    }
                }
            );
        return () => {
            current = false;
        };
    }, [endpointId, path, platform]);

    const enter = (folder: string): void => setPath(endsWithSeparator(folder) ? folder : `${folder}${sep}`);
    const parent = listing === null ? null : parentOf(listing.parentPath, sep);
    return (
        <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={onBack}>
                    <Icon icon={ArrowLeft} size={14} /> {t('remoteNode.folders.back')}
                </Button>
            </div>
            <Input mono aria-label={t('remoteNode.folders.path', { machine })} value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)} />
            {failure !== null && <FormError>{failure}</FormError>}
            <ScrollArea
                render={<ul />}
                className="max-h-48 overflow-hidden rounded-md border border-border"
                aria-label={t('remoteNode.folders.title', { machine })}
            >
                {parent !== null && (
                    <li>
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-surface-raised"
                            onClick={() => enter(parent)}
                        >
                            <Icon icon={CornerLeftUp} size={14} /> {t('remoteNode.folders.up')}
                        </button>
                    </li>
                )}
                {(listing?.entries ?? []).map((entry) => (
                    <li key={entry.fullPath}>
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-surface-raised"
                            onClick={() => enter(entry.fullPath)}
                        >
                            <Icon icon={entry.hasCanvas ? FolderCheck : Folder} size={14} /> <span className="truncate">{entry.name}</span>
                        </button>
                    </li>
                ))}
                {listing !== null && listing.entries.length === 0 && <li className="px-2 py-1 text-sm text-text-muted">{t('remoteNode.folders.none')}</li>}
            </ScrollArea>
            <Button size="sm" variant="primary" disabled={listing === null} onClick={() => listing !== null && onPick(listing.parentPath)}>
                {t('remoteNode.folders.use')}
            </Button>
        </div>
    );
}
