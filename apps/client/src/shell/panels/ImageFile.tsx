import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, ImageOff, Maximize, Scan } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { drawsImageMime, imageFormatName } from '@/shell/panels/file-kind';
import { FileContextMenu, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { Button, ButtonGroup, EmptyState, Icon } from '@basmilius/react-ui';
import { formatBytes } from '@basmilius/react-ui/format';

type Zoom = 'fit' | 'full';

/* An image from the daemon's own route, on a plain surface: a checkerboard would fight every icon
   drawn for a light background. */
export function ImageFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const [zoom, setZoom] = useState<Zoom>('fit');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const drawable = drawsImageMime(read.mime);
    const bytes = useMachineUrl(drawable ? { kind: 'file', path, mtime: read.mtime, size: read.size } : null, endpointId);

    const reveal = (): void => {
        void transport.request('fs.reveal', { path }).catch(() => undefined);
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {drawable ? (
                <FileToolbar>
                    <ButtonGroup>
                        <FileToolbarToggle icon={Maximize} label={t('file.image.fit')} active={zoom === 'fit'} onClick={() => setZoom('fit')} />
                        <FileToolbarToggle icon={Scan} label={t('file.image.actual')} active={zoom === 'full'} onClick={() => setZoom('full')} />
                    </ButtonGroup>
                </FileToolbar>
            ) : (
                <FileToolbar />
            )}
            <FileContextMenu className="grid min-h-0 grow place-items-center overflow-auto bg-surface-sunken p-4">
                {!drawable ? (
                    <EmptyState
                        className="select-text"
                        icon={ImageOff}
                        action={
                            <Button variant="secondary" size="sm" onClick={reveal}>
                                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                            </Button>
                        }
                    >
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
            </FileContextMenu>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
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
