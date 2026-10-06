import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, ImageOff } from 'lucide-react';
import { isImageMime, type FsReadResult } from '@ruimte/contracts';
import { ImageThumb } from '@adecore/agents-react/chat/ui/ImageView';
import { drawsImageMime, imageFormatName } from '@/shell/panels/file-kind';
import { useEndpointId } from '@/state/keys';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { Button, Icon } from '@adecore/ui';

/*
 * The image an agent looked at with `Read`. The thread only carries the path, so the daemon is
 * asked what the file is; anything that is not an image draws nothing at all.
 */
export function ReadImage({ path }: { path: string }) {
    const { t } = useTranslation(['chat', 'panels']);
    const platform = useServer((s) => s.platform);
    const [read, setRead] = useState<FsReadResult | null>(null);
    const [failed, setFailed] = useState(false);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const binary = read?.kind === 'binary' && isImageMime(read.mime) ? read : null;
    const drawable = binary !== null && drawsImageMime(binary.mime);
    const source = useMachineUrl(binary === null || !drawable ? null : { kind: 'file', path, mtime: binary.mtime, size: binary.size }, endpointId);

    useEffect(() => {
        let cancelled = false;
        transport
            .request('fs.read', { path })
            .then((result) => {
                if (!cancelled) {
                    setRead(result);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFailed(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [transport, path]);

    if (failed) {
        return (
            <div className="mb-1 ml-8 flex items-center gap-1.5 text-xs text-text-faint">
                <Icon icon={ImageOff} size={12} /> {t('image.gone')}
            </div>
        );
    }
    if (binary === null) {
        return null;
    }
    if (!drawable) {
        return (
            <div className="mb-1 ml-8 flex items-center gap-1.5 text-xs text-text-faint">
                <Icon icon={ImageOff} size={12} /> {t('image.notShown', { format: imageFormatName(binary.mime) })}
                <Button size="sm" onClick={() => void transport.request('fs.reveal', { path }).catch(() => undefined)}>
                    <Icon icon={CornerUpRight} size={14} /> {t('panels:file.revealIn', { app: fileManagerName(platform) })}
                </Button>
            </div>
        );
    }
    return (
        <div className="mb-1 ml-8">
            <ImageThumb source={source} alt={path} className="max-h-48 max-w-full object-contain" />
        </div>
    );
}
