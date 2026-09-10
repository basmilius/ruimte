import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { FsReadBinary } from '@ruimte/contracts';
import { fileBytesUrl } from '@/shell/panels/file-url';
import { formatBytes } from '@/shell/panels/file-size';
import { Segmented } from '@/shell/settings/controls';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

type Zoom = 'fit' | 'full';

const ZOOMS: Array<{ id: Zoom; label: string }> = [
    { id: 'fit', label: 'Fit' },
    { id: 'full', label: '1:1' }
];

/* An image from the daemon's own route, on a plain surface: a checkerboard would fight every icon
   drawn for a light background. */
export function ImageFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const [zoom, setZoom] = useState<Zoom>('fit');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className="file-toolbar">
                <Segmented value={zoom} options={ZOOMS} onChange={(id) => setZoom(id)} label="How large to draw this image" />
            </div>
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
            <div className="file-footer">
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
