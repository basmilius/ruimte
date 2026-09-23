import { isImageMime, isVideoMime, type FsReadResult, type FsReadText } from '@ruimte/contracts';
import { CodeFile } from '@/shell/panels/CodeFile';
import { isHtmlName, isMarkdownName } from '@/shell/panels/file-kind';
import { HtmlFile } from '@/shell/panels/HtmlFile';
import { ImageFile } from '@/shell/panels/ImageFile';
import { MarkdownFile } from '@/shell/panels/MarkdownFile';
import { UnsupportedFile } from '@/shell/panels/UnsupportedFile';
import { VideoFile } from '@/shell/panels/VideoFile';

export interface FileRendererProps {
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
    read: FsReadResult;
}

export interface TextFileRenderer {
    id: string;
    /* Whether this renderer takes the file, decided on its name alone. */
    match(name: string): boolean;
    render(props: { path: string; name: string; read: FsReadText }): React.JSX.Element;
}

/*
 * What draws a text file, tried in order; anything no entry claims falls to the code view, which
 * takes every language shiki knows and plain text for the rest.
 */
export const TEXT_RENDERERS: readonly TextFileRenderer[] = [
    {
        id: 'markdown',
        match: (name) => isMarkdownName(name),
        render: (props) => <MarkdownFile path={props.path} read={props.read} />
    },
    {
        id: 'html',
        match: (name) => isHtmlName(name),
        render: (props) => <HtmlFile path={props.path} name={props.name} read={props.read} />
    }
];

/* The name picks a renderer for a text file; what the read found picks everything else. */
export const renderFile = ({ path, name, read }: FileRendererProps): React.JSX.Element => {
    if (read.kind === 'text') {
        const renderer = TEXT_RENDERERS.find((entry) => entry.match(name));
        return renderer ? renderer.render({ path, name, read }) : <CodeFile path={path} read={read} />;
    }
    if (read.kind === 'binary' && isImageMime(read.mime)) {
        return <ImageFile path={path} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isVideoMime(read.mime)) {
        return <VideoFile path={path} name={name} read={read} />;
    }
    return <UnsupportedFile path={path} name={name} read={read} />;
};
