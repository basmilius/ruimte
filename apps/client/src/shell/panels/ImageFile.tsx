import { useState } from 'react';
import { ImageOff, Maximize, Scan } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { fileBytesUrl } from '@/shell/panels/file-url';
import { formatBytes } from '@/shell/panels/file-size';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

type Zoom = 'fit' | 'full';

/* An image from the daemon's own route, on a plain surface: a checkerboard would fight every icon
   drawn for a light background. */
export function ImageFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const [zoom, setZoom] = useState<Zoom>('fit');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                <div className="btn-group">
                    <FileToolbarToggle icon={Maximize} label="Fit to the panel" active={zoom === 'fit'} onClick={() => setZoom('fit')} />
                    <FileToolbarToggle icon={Scan} label="Actual size (1:1)" active={zoom === 'full'} onClick={() => setZoom('full')} />
                </div>
            </FileToolbar>
            <div className="grid min-h-0 grow place-items-center overflow-auto bg-surface-sunken p-4">
                {failed ? (
                    <EmptyState icon={<Icon icon={ImageOff} size={20} />}>{name} could not be drawn; the file may have changed while it loaded.</EmptyState>
                ) : (
                    <img
                        src={fileBytesUrl(path, read.mtime, read.size)}
                        alt={name}
                        className={zoom === 'fit' ? 'h-auto max-w-full' : 'max-w-none'}
                        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                        onError={() => setFailed(true)}
                    />
                )}
            </div>
            <div className="file-footer select-text">
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
