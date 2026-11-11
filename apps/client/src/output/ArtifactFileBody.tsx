import { EmptyState, ScrollArea } from '@adecore/ui';
import { injectVisualBootstrap, type ArtifactFile } from '@ruimte/contracts';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeText } from '@/files/CodeFile';
import { FileActionsContext } from '@/files/file-actions';
import { FileMarkdown } from '@/files/FileMarkdown';
import { ImageFile } from '@/files/ImageFile';
import { MediaFile } from '@/files/MediaFile';
import { ModelPreview } from '@/files/ModelPreview';
import { PdfPreview } from '@/files/PdfPreview';
import { readArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { artifactBinaryRead, artifactSource, fileViewOf, languageOfName } from '@/output/file-view';
import { PageReadFrame } from '@/surface/PageReadFrame';

interface ArtifactFileProps {
    endpointId: string;
    reference: ArtifactFileRef;
    file: ArtifactFile;
    title: string;
    /* A version never changes, so its time pins the bytes the way a file's mtime does. */
    createdAt: number;
}

/*
 * One file of a version across the view, drawn by what the file is with the renderers of the files
 * panel. No file menu: it is no file on disk, so nothing of it can be revealed, renamed or saved over.
 * Null for a file there is nothing to show of.
 */
export function ArtifactFileBody(props: ArtifactFileProps) {
    const { endpointId, reference, file, createdAt } = props;
    const view = fileViewOf(file);
    const source = artifactSource(endpointId, reference);
    const read = artifactBinaryRead(file, createdAt);
    const body = (): ReactNode => {
        switch (view) {
            case 'page':
                return <ArtifactPage {...props} />;
            case 'markdown':
            case 'code':
                return <ArtifactText {...props} markdown={view === 'markdown'} />;
            case 'image':
                return <ImageFile source={source} name={file.name} read={read} />;
            case 'video':
                return <MediaFile kind="video" source={source} name={file.name} read={read} />;
            case 'audio':
                return <MediaFile kind="audio" source={source} name={file.name} read={read} />;
            case 'pdf':
                return <PdfPreview source={source} name={file.name} read={read} />;
            case 'model':
                return <ModelPreview source={source} name={file.name} read={read} />;
            case 'none':
                return null;
        }
    };
    return <FileActionsContext.Provider value={null}>{body()}</FileActionsContext.Provider>;
}

/*
 * An agent's page, in the same sandboxed frame a chat draws a visual in and never on the app's own
 * origin, whatever kind the artifact says it is: the preview the files panel gives a project's HTML
 * runs no script, and a page an agent made for a person is meant to. `auto` grows the frame with its page
 * the way a visual in a chat does; without it the page fills its box.
 */
export function ArtifactPage({ endpointId, reference, file, title, auto = false }: ArtifactFileProps & { auto?: boolean }) {
    const { t } = useTranslation('output');
    const readKey = `${endpointId}:${reference.artifactId}:${reference.versionId}:${reference.file}`;
    // Keyed too, so another file starts from its own progress line rather than showing the last page until it is read.
    const frame = (
        <PageReadFrame
            key={readKey}
            // With the bootstrap a chat's visual is served with: it reports the page's size and takes the theme, which is what ends the frame's wait.
            read={() =>
                readArtifactFile(endpointId, reference, file)
                    .then((blob) => blob.text())
                    .then(injectVisualBootstrap)
            }
            readKey={readKey}
            title={title}
            name={file.name}
            readingLabel={t('view.readingPage')}
            auto={auto}
        />
    );
    if (auto) {
        return frame;
    }
    return <div className="relative min-h-0 grow">{frame}</div>;
}

function ArtifactText({ endpointId, reference, file, markdown }: ArtifactFileProps & { markdown: boolean }) {
    const { t } = useTranslation('output');
    const text = useArtifactText(endpointId, reference, file);
    if (text.status !== 'ready') {
        return (
            <div className="grid min-h-0 grow place-items-center">
                {text.status === 'loading' ? (
                    <EmptyState busy>{t('view.loading')}</EmptyState>
                ) : (
                    <EmptyState icon={CircleAlert}>{t('view.readFailed')}</EmptyState>
                )}
            </div>
        );
    }
    if (!markdown) {
        return (
            <div className="flex min-h-0 min-w-0 grow flex-col">
                <CodeText text={text.text} language={languageOfName(file.name)} />
            </div>
        );
    }
    return (
        <ScrollArea className="grow" viewportClassName="px-6 py-6 select-text">
            <div className="mx-auto max-w-[768px]">
                <FileMarkdown text={text.text} />
            </div>
        </ScrollArea>
    );
}
