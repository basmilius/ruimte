import {
    isArchiveMime,
    isAudioMime,
    isImageMime,
    isModelMime,
    isPdfMime,
    isVideoMime,
    type FsReadBinary,
    type FsReadResult,
    type FsReadText
} from '@ruimte/contracts';
import { ArchivePreview } from '@/files/ArchivePreview';
import { CodeFile } from '@/files/CodeFile';
import { HtmlFile } from '@/files/HtmlFile';
import { ImageFile } from '@/files/ImageFile';
import { MarkdownFile } from '@/files/MarkdownFile';
import { MediaFile } from '@/files/MediaFile';
import { ModelPreview } from '@/files/ModelPreview';
import { PatchFileSlot } from '@/files/patch-file-lazy';
import { PdfPreview } from '@/files/PdfPreview';
import { TableFile } from '@/files/TableFile';
import { UnsupportedFile } from '@/files/UnsupportedFile';
import { isDelimitedName, isHtmlName, isMarkdownName, isPatchName } from '@/surface/panels/file-kind';
import { fileSource, type FileSource } from '@/surface/panels/file-source';

interface FileRendererProps {
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
    read: FsReadResult;
}

type TextProps = { path: string; name: string; read: FsReadText };

/*
 * What draws a text file, tried in order on its name; anything no entry claims falls to the code view,
 * which takes every language shiki knows and plain text for the rest.
 */
const TEXT_RENDERERS: readonly [match: (name: string) => boolean, render: (props: TextProps) => React.JSX.Element][] = [
    [isMarkdownName, ({ path, read }) => <MarkdownFile path={path} read={read} />],
    [isHtmlName, (props) => <HtmlFile {...props} />],
    [isPatchName, ({ path, read }) => <PatchFileSlot path={path} read={read} />],
    [isDelimitedName, (props) => <TableFile {...props} />]
];

/* A binary file by its type, wherever its bytes come from; null for a type no renderer here draws. */
export function renderBinary(source: FileSource, name: string, read: FsReadBinary): React.JSX.Element | null {
    if (isImageMime(read.mime)) {
        return <ImageFile source={source} name={name} read={read} />;
    }
    if (isVideoMime(read.mime) || isAudioMime(read.mime)) {
        return <MediaFile kind={isVideoMime(read.mime) ? 'video' : 'audio'} source={source} name={name} read={read} />;
    }
    if (isPdfMime(read.mime)) {
        return <PdfPreview source={source} name={name} read={read} />;
    }
    if (isModelMime(read.mime)) {
        return <ModelPreview source={source} name={name} read={read} />;
    }
    return null;
}

/* The name picks a renderer for a text file; what the read found picks everything else. */
export function renderFile({ path, name, read }: FileRendererProps): React.JSX.Element {
    if (read.kind === 'text') {
        const render = TEXT_RENDERERS.find(([match]) => match(name))?.[1];
        return render === undefined ? <CodeFile path={path} read={read} /> : render({ path, name, read });
    }
    if (read.kind === 'binary') {
        const drawn = renderBinary(fileSource(path), name, read);
        if (drawn !== null) {
            return drawn;
        }
        if (isArchiveMime(read.mime)) {
            return <ArchivePreview path={path} name={name} read={read} />;
        }
    }
    return <UnsupportedFile path={path} name={name} read={read} />;
}
