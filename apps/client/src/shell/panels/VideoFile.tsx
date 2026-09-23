import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, FileVideo } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { formatBytes } from '@/shell/panels/file-size';
import { FileContextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/*
 * Whether there is any point in drawing a player. The mime names the container, and a container the
 * runtime knows is not a promise about the codecs inside it, so `canPlayType` answers "maybe" more
 * often than "probably"; an empty answer is the only certain no, and the one this asks about.
 */
const canPlay = (mime: string): boolean => typeof document !== 'undefined' && document.createElement('video').canPlayType(mime) !== '';

/* A video from the daemon's own route, which serves it in ranges so the scrubber works. */
export function VideoFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(!canPlay(read.mime));
    const transport = useTransport();
    const endpointId = useEndpointId();
    const bytes = useMachineUrl({ kind: 'file', path, mtime: read.mtime, size: read.size }, endpointId);

    const reveal = (): void => {
        void transport.request('fs.reveal', { path }).catch(() => undefined);
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <FileContextMenu className="grid min-h-0 grow place-items-center overflow-auto bg-surface-sunken p-4">
                {failed || bytes.failure !== null ? (
                    <EmptyState
                        className="select-text"
                        icon={<Icon icon={FileVideo} size={20} />}
                        action={
                            <Button variant="secondary" size="sm" onClick={reveal}>
                                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                            </Button>
                        }
                    >
                        {t('file.video.cannotPlay', { name, mime: read.mime, size: formatBytes(read.size) })}
                        {bytes.failure !== null && ` ${bytes.failure}.`}
                    </EmptyState>
                ) : (
                    bytes.url !== null && (
                        <video
                            controls
                            preload="metadata"
                            src={bytes.url}
                            className="max-h-full max-w-full"
                            onLoadedMetadata={(event) => setSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
                            onError={() => setFailed(true)}
                        />
                    )
                )}
            </FileContextMenu>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                {size !== null && size.width > 0 && (
                    <span>
                        {size.width} x {size.height}
                    </span>
                )}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}
