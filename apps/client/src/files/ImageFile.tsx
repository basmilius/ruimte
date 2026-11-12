import { ButtonGroup, EmptyState, ScrollArea } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import type { FsReadBinary } from '@ruimte/contracts';
import { Fullscreen, ImageOff, Ratio } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileContextMenu, FileToolbar, FileToolbarToggle } from '@/files/FileToolbar';
import { RevealButton } from '@/files/RevealButton';
import { FILE_FOOTER } from '@/surface/panels/classes';
import { drawsImageMime, imageFormatName } from '@/surface/panels/file-kind';
import { machineResourceOf, revealablePath, useEndpointIdOf, type FileSource } from '@/surface/panels/file-source';
import { useMachineUrl } from '@/transport/machine-url';

type Zoom = 'fit' | 'full';

/* An image from the daemon's own route, on a plain surface: a checkerboard would fight every icon
   drawn for a light background. */
export function ImageFile({ source, name, read }: { source: FileSource; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const [zoom, setZoom] = useState<Zoom>('fit');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);
    const endpointId = useEndpointIdOf(source);
    const drawable = drawsImageMime(read.mime);
    const bytes = useMachineUrl(drawable ? machineResourceOf(source, read) : null, endpointId);
    const path = revealablePath(source);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {drawable ? (
                <FileToolbar>
                    <ButtonGroup>
                        <FileToolbarToggle icon={Fullscreen} label={t('file.image.fit')} active={zoom === 'fit'} onClick={() => setZoom('fit')} />
                        <FileToolbarToggle icon={Ratio} label={t('file.image.actual')} active={zoom === 'full'} onClick={() => setZoom('full')} />
                    </ButtonGroup>
                </FileToolbar>
            ) : (
                <FileToolbar />
            )}
            <FileContextMenu className="flex min-h-0 grow flex-col bg-surface-sunken">
                <ScrollArea axis="both" className="grow" viewportClassName="grid place-items-center p-4">
                    {!drawable ? (
                        <EmptyState className="select-text" icon={ImageOff} action={path === null ? undefined : <RevealButton path={path} />}>
                            {t('file.image.notShown', { name, format: imageFormatName(read.mime) })}
                        </EmptyState>
                    ) : failed || bytes.failure !== null ? (
                        <EmptyState icon={ImageOff}>{t('file.image.failed', { name, reason: bytes.failure ?? t('file.image.maybeChanged') })}</EmptyState>
                    ) : (
                        bytes.url !== null && (
                            <img
                                src={bytes.url}
                                alt={name}
                                className={zoom === 'fit' ? 'h-auto max-w-full' : 'max-w-none'}
                                onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                                onError={() => setFailed(true)}
                            />
                        )
                    )}
                </ScrollArea>
            </FileContextMenu>
            <div className={FILE_FOOTER}>
                {/* An SVG without a width of its own reports nothing, and 0 x 0 is worse than no line at all. */}
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
