import { ImageThumb } from '@adecore/agents-react/chat/ui';
import { Button, Icon } from '@adecore/ui';
import { isImageMime, type FsReadResult } from '@ruimte/contracts';
import { CornerUpRight, ImageOff, PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutputChat } from '@/output/chat-scope';
import { saveToOutput, useOutputProject } from '@/output/save';
import { useEndpointId } from '@/state/current-endpoint';
import { fileManagerName, useServer } from '@/state/server';
import { drawsImageMime, imageFormatName } from '@/surface/panels/file-kind';
import { useMachineUrl } from '@/transport/machine-url';
import { useTransport } from '@/workspace/context';

const PLACES = {
    tool: { box: 'mb-1 ml-8', image: 'max-h-48 max-w-full object-contain' },
    reply: { box: 'my-2', image: 'max-h-70 max-w-full object-contain' }
};

/*
 * The image an agent looked at with `Read`. The thread only carries the path, so the daemon is
 * asked what the file is; anything that is not an image draws nothing at all.
 */
export function ReadImage({ path }: { path: string }) {
    return <MachineImage path={path} alt={path} place="tool" saves />;
}

/* An image a reply names by its path on the machine. It sits inside a paragraph, which is why every box here is a span. */
export function MarkdownImage({ path, alt }: { path: string; alt: string }) {
    return <MachineImage path={path} alt={alt === '' ? path : alt} place="reply" />;
}

function MachineImage({ path, alt, place, saves = false }: { path: string; alt: string; place: keyof typeof PLACES; saves?: boolean }) {
    const { t } = useTranslation(['chat', 'panels', 'output']);
    const chatId = useOutputChat();
    const [saving, setSaving] = useState(false);
    const platform = useServer((s) => s.platform);
    const [read, setRead] = useState<FsReadResult | null>(null);
    const [failed, setFailed] = useState(false);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const outputProject = useOutputProject(endpointId);
    const binary = read?.kind === 'binary' && isImageMime(read.mime) ? read : null;
    const drawable = binary !== null && drawsImageMime(binary.mime);
    const source = useMachineUrl(
        binary === null || !drawable ? null : { kind: 'file', path, mtime: binary.mtime, size: binary.size, mime: binary.mime },
        endpointId
    );

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
            <span className={`${PLACES[place].box} flex items-center gap-1.5 text-xs text-text-faint`}>
                <Icon icon={ImageOff} size={12} /> {t('image.gone')}
            </span>
        );
    }
    if (binary === null) {
        return null;
    }
    if (!drawable) {
        return (
            <span className={`${PLACES[place].box} flex items-center gap-1.5 text-xs text-text-faint`}>
                <Icon icon={ImageOff} size={12} /> {t('image.notShown', { format: imageFormatName(binary.mime) })}
                <Button size="sm" onClick={() => void transport.request('fs.reveal', { path }).catch(() => undefined)}>
                    <Icon icon={CornerUpRight} size={14} /> {t('panels:file.revealIn', { app: fileManagerName(platform) })}
                </Button>
            </span>
        );
    }
    const projectId = saves && chatId !== null ? outputProject : null;
    const save = (): void => {
        if (chatId === null || projectId === null) {
            return;
        }
        setSaving(true);
        void saveToOutput(endpointId, projectId, { kind: 'image', chatId, path }).finally(() => setSaving(false));
    };
    return (
        <span className={`${PLACES[place].box} flex items-start gap-2`}>
            <ImageThumb source={source} alt={alt} className={PLACES[place].image} />
            {projectId !== null && (
                <Button size="xs" disabled={saving} onClick={save}>
                    <Icon icon={PackagePlus} size={12} /> {t('output:chat.save')}
                </Button>
            )}
        </span>
    );
}
