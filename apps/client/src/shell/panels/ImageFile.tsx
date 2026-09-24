import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff, Maximize, Scan } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { useMachineUrl } from '@/transport/machine-url';
import { formatBytes } from '@/shell/panels/file-size';
import { FileContextMenu, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';

type Zoom = 'fit' | 'full';

/* An image from the daemon's own route, on a plain surface: a checkerboard would fight every icon
   drawn for a light background. */
export function ImageFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const [zoom, setZoom] = useState<Zoom>('fit');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);
    const endpointId = useEndpointId();
    const bytes = useMachineUrl({ kind: 'file', path, mtime: read.mtime, size: read.size }, endpointId);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                <div className={BTN_GROUP}>
                    <FileToolbarToggle icon={Maximize} label={t('file.image.fit')} active={zoom === 'fit'} onClick={() => setZoom('fit')} />
                    <FileToolbarToggle icon={Scan} label={t('file.image.actual')} active={zoom === 'full'} onClick={() => setZoom('full')} />
                </div>
            </FileToolbar>
            <FileContextMenu className="grid min-h-0 grow place-items-center overflow-auto bg-surface-sunken p-4">
                {failed || bytes.failure !== null ? (
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
