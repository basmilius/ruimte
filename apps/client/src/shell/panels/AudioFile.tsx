import { revealFile } from './reveal-file';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, FileAudio } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { FileContextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { Button, EmptyState, Icon } from '@basmilius/desktop-ui';
import { formatBytes, formatClockDuration } from '@basmilius/desktop-ui/format';

// An empty answer is the only certain no; see `VideoFile`.
function canPlay(mime: string): boolean {
    return typeof document !== 'undefined' && document.createElement('audio').canPlayType(mime) !== '';
}

/* Sound in ranges, the way `VideoFile` plays a video. */
export function AudioFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const [duration, setDuration] = useState<number | null>(null);
    const [failed, setFailed] = useState(!canPlay(read.mime));
    const transport = useTransport();
    const endpointId = useEndpointId();
    const bytes = useMachineUrl({ kind: 'media', path, mtime: read.mtime, size: read.size }, endpointId);

    const reveal = (): void => {
        revealFile(transport, path);
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <FileContextMenu className="grid min-h-0 grow place-items-center overflow-auto bg-surface-sunken p-4">
                {failed || bytes.failure !== null ? (
                    <EmptyState
                        className="select-text"
                        icon={FileAudio}
                        action={
                            <Button variant="secondary" size="sm" onClick={reveal}>
                                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                            </Button>
                        }
                    >
                        {t('file.audio.cannotPlay', { name, mime: read.mime, size: formatBytes(read.size) })}
                        {bytes.failure !== null && ` ${bytes.failure}.`}
                    </EmptyState>
                ) : (
                    bytes.url !== null && (
                        <audio
                            controls
                            preload="metadata"
                            src={bytes.url}
                            className="w-full max-w-xl"
                            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                            onError={() => setFailed(true)}
                        />
                    )
                )}
            </FileContextMenu>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                {duration !== null && Number.isFinite(duration) && <span>{formatClockDuration(duration * 1000)}</span>}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}
