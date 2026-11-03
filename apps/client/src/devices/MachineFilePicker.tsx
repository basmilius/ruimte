import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerLeftUp, File, Folder } from 'lucide-react';
import type { FsEntry, FsListResult } from '@ruimte/contracts';
import { transportFor } from '@/transport';
import { Button, Checkbox, CloseButton, FormError, Icon, IconButton, MiddleTruncate, messageOf, ScrollArea } from '@adecore/ui';

/*
 * Files of the machine a device runs on, one folder at a time, so a person on another machine picks a
 * file there the same way. A folder `pickable` takes is a file to it, as an app bundle is.
 */
export function MachineFilePicker({
    endpointId,
    start,
    pickable,
    multiple = false,
    confirmLabel,
    onPick,
    onCancel
}: {
    endpointId: string;
    start: string;
    pickable: (path: string) => boolean;
    multiple?: boolean;
    confirmLabel: string;
    onPick(paths: string[]): void;
    onCancel(): void;
}) {
    const { t } = useTranslation('machines');
    const [folder, setFolder] = useState(start);
    const [listing, setListing] = useState<FsListResult | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [chosen, setChosen] = useState<readonly string[]>([]);

    useEffect(() => {
        let current = true;
        transportFor(endpointId)
            ?.request('fs.list', { path: folder })
            .then(
                (answer) => {
                    if (current) {
                        setListing(answer);
                        setFailure(null);
                    }
                },
                (error: unknown) => {
                    if (current) {
                        setFailure(messageOf(error));
                    }
                }
            );
        return () => {
            current = false;
        };
    }, [endpointId, folder]);

    const parent = folder.replace(/\/[^/]+\/?$/, '') || '/';
    // Build output counts as hidden in a listing, and that is where an app bundle is, so only dot files stay out.
    const entries = (listing?.entries ?? []).filter((entry) => !entry.name.startsWith('.') && (entry.kind === 'directory' || pickable(entry.path)));
    const choose = (entry: FsEntry): void => {
        if (!multiple) {
            onPick([entry.path]);
            return;
        }
        setChosen((previous) => (previous.includes(entry.path) ? previous.filter((path) => path !== entry.path) : [...previous, entry.path].slice(0, 20)));
    };
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-1">
                <IconButton icon={CornerLeftUp} size="sm" label={t('device.tools.files.up')} disabled={folder === '/'} onClick={() => setFolder(parent)} />
                <MiddleTruncate className="min-w-0 grow font-mono text-xs text-text-muted" text={folder} />
                <CloseButton label={t('device.tools.files.cancel')} onClick={onCancel} />
            </div>
            {failure !== null && <FormError>{failure}</FormError>}
            <ScrollArea render={<ul />} className="max-h-48 overflow-hidden rounded-md border border-border" aria-label={t('device.tools.files.list')}>
                {entries.map((entry) => {
                    const file = pickable(entry.path);
                    return (
                        <li key={entry.path}>
                            {file && multiple ? (
                                <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-sm">
                                    <Checkbox checked={chosen.includes(entry.path)} label={entry.name} onCheckedChange={() => choose(entry)} />
                                    <span className="truncate">{entry.name}</span>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-sm hover:bg-surface-hover"
                                    onClick={() => (file ? choose(entry) : setFolder(entry.path))}
                                >
                                    <Icon icon={file ? File : Folder} size={14} className="shrink-0 text-text-muted" />
                                    <span className="truncate">{entry.name}</span>
                                </button>
                            )}
                        </li>
                    );
                })}
                {listing !== null && entries.length === 0 && <li className="px-2 py-1 text-xs text-text-muted">{t('device.tools.files.empty')}</li>}
            </ScrollArea>
            {multiple && (
                <Button size="sm" variant="primary" className="self-end" disabled={chosen.length === 0} onClick={() => onPick([...chosen])}>
                    {confirmLabel}
                </Button>
            )}
        </div>
    );
}
