import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';
import { isImageMime, type FsReadResult } from '@ruimte/contracts';
import { ImageThumb } from '@ruimte/agents-react/chat/ui/ImageView';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { Icon } from '@ruimte/ui/Icon';

/*
 * The image an agent looked at with `Read`. The thread only carries the path, so the daemon is
 * asked what the file is; anything that is not an image draws nothing at all.
 */
export function ReadImage({ path }: { path: string }) {
    const { t } = useTranslation('chat');
    const [read, setRead] = useState<FsReadResult | null>(null);
    const [failed, setFailed] = useState(false);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const binary = read?.kind === 'binary' && isImageMime(read.mime) ? read : null;
    const source = useMachineUrl(binary === null ? null : { kind: 'file', path, mtime: binary.mtime, size: binary.size }, endpointId);

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
    return (
        <div className="mb-1 ml-8">
            <ImageThumb source={source} alt={path} className="max-h-48 max-w-full object-contain" />
        </div>
    );
}
