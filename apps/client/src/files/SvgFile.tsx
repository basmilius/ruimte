import { EmptyState, Separator } from '@adecore/ui';
import type { FsReadBinary, FsReadText } from '@ruimte/contracts';
import { FileWarning, Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '@/files/CodeFile';
import { FileToolbar } from '@/files/FileToolbar';
import { ImageFile, ImageZoomButtons } from '@/files/ImageFile';
import { useSourceToggle } from '@/files/use-source-toggle';
import { useEndpointId } from '@/state/current-endpoint';
import { fileSource } from '@/surface/panels/file-source';
import { readLargeText } from '@/transport/large-text';

type SourceRead = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; read: FsReadText };

/*
 * An SVG drawn as the picture it is, with its markup a click away. The daemon names an SVG an image, so
 * `fs.read` never sends its text: the source view fetches the bytes over the file route, and only once a
 * person asks for it.
 */
export function SvgFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const { source, toggle } = useSourceToggle(path, Image, { label: t('file.view.preview'), afterSave: t('file.view.previewAfterSave') });
    const endpointId = useEndpointId();
    const [text, setText] = useState<SourceRead>({ status: 'loading' });
    const { size, mtime } = read;

    useEffect(() => {
        if (!source) {
            return undefined;
        }
        let cancelled = false;
        readLargeText(endpointId, path, { kind: 'too-large', size, mtime }, null)
            .then((fetched) => {
                if (!cancelled) {
                    setText(fetched.kind === 'text' ? { status: 'ready', read: { ...fetched, language: 'xml' } } : { status: 'failed' });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setText({ status: 'failed' });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [source, endpointId, path, size, mtime]);

    if (!source) {
        return <ImageFile source={fileSource(path)} name={name} read={read} toolbarExtra={toggle} />;
    }
    // The zoom pair stays in its place while the source is up, so the toggle does not move under the pointer.
    const controls = (
        <>
            {toggle}
            <Separator />
            <ImageZoomButtons zoom="fit" />
        </>
    );
    if (text.status === 'ready') {
        return <CodeFile path={path} read={text.read} toolbarExtra={controls} />;
    }
    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>{controls}</FileToolbar>
            {text.status === 'failed' && <EmptyState icon={FileWarning}>{t('file.readFailed')}</EmptyState>}
        </div>
    );
}
