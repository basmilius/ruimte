import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileAudio, FileVideo } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { FILE_FOOTER } from '@/shell/panels/classes';
import { FileContextMenu, FileToolbar } from '@/shell/panels/FileToolbar';
import { machineResourceOf, revealablePath, useEndpointIdOf, type FileSource } from '@/shell/panels/file-source';
import { RevealButton } from '@/shell/panels/RevealButton';
import { useMachineUrl } from '@/transport/machine-url';
import { EmptyState, ScrollArea } from '@adecore/ui';
import { formatBytes, formatClockDuration } from '@adecore/ui/format';

interface MediaFileProps {
    kind: 'audio' | 'video';
    source: FileSource;
    name: string;
    read: FsReadBinary;
}

interface Loaded {
    duration: number;
    width: number;
    height: number;
}

/* `canPlayType` knows the container, not its codecs, so it says "maybe" often; an empty answer is the only certain no. */
function canPlay(kind: MediaFileProps['kind'], mime: string): boolean {
    return typeof document !== 'undefined' && document.createElement(kind).canPlayType(mime) !== '';
}

/* Sound or a video in ranges, so the scrubber works: from the daemon's own route, or over a direct connection through the bytes worker. */
export function MediaFile({ kind, source, name, read }: MediaFileProps) {
    const { t } = useTranslation('panels');
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [failed, setFailed] = useState(!canPlay(kind, read.mime));
    const endpointId = useEndpointIdOf(source);
    const bytes = useMachineUrl(machineResourceOf(source, read, true), endpointId);
    const path = revealablePath(source);
    const Media = kind;

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar />
            <FileContextMenu className="flex min-h-0 grow flex-col bg-surface-sunken">
                <ScrollArea axis="both" className="grow" viewportClassName="grid place-items-center p-4">
                    {failed || bytes.failure !== null ? (
                        <EmptyState
                            className="select-text"
                            icon={kind === 'audio' ? FileAudio : FileVideo}
                            action={path === null ? undefined : <RevealButton path={path} />}
                        >
                            {t(`file.${kind}.cannotPlay`, { name, mime: read.mime, size: formatBytes(read.size) })}
                            {bytes.failure !== null && ` ${bytes.failure}.`}
                        </EmptyState>
                    ) : (
                        bytes.url !== null && (
                            <Media
                                controls
                                preload="metadata"
                                src={bytes.url}
                                className={kind === 'audio' ? 'w-full max-w-xl' : 'max-h-full max-w-full'}
                                onLoadedMetadata={(event) => {
                                    const media = event.currentTarget;
                                    setLoaded({
                                        duration: media.duration,
                                        width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
                                        height: media instanceof HTMLVideoElement ? media.videoHeight : 0
                                    });
                                }}
                                onError={() => setFailed(true)}
                            />
                        )
                    )}
                </ScrollArea>
            </FileContextMenu>
            <div className={FILE_FOOTER}>
                {kind === 'audio' && loaded !== null && Number.isFinite(loaded.duration) && <span>{formatClockDuration(loaded.duration * 1000)}</span>}
                {kind === 'video' && loaded !== null && loaded.width > 0 && (
                    <span>
                        {loaded.width} x {loaded.height}
                    </span>
                )}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}
