import { useMemo, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/chat/ui/Markdown';
import { useFileLinkCwd } from '@/shell/panels/file-links';
import { parseMarkdownDocument, markdownImagePath } from '@/shell/panels/markdown-document';
import { FILE_HTML_PLUGINS } from '@/shell/panels/markdown-html';
import { useFileRead } from '@/shell/panels/use-file-read';
import { useEndpointId } from '@/state/keys';
import { useMachineUrl } from '@/transport/machine-url';

type ImageProps = Pick<ComponentProps<'img'>, 'src' | 'alt' | 'title' | 'width' | 'height'>;

function LocalImage({ path, ...props }: ImageProps & { path: string }) {
    const { state } = useFileRead(path);
    const endpointId = useEndpointId();
    const resource =
        state.status === 'ready' && state.read.kind === 'binary' && state.read.mime.startsWith('image/')
            ? { kind: 'file' as const, path, mtime: state.read.mtime, size: state.read.size }
            : null;
    const bytes = useMachineUrl(resource, endpointId);
    return <img {...props} src={bytes.url ?? undefined} loading="lazy" referrerPolicy="no-referrer" />;
}

function DocumentImage({ src, alt, title, width, height }: ImageProps) {
    const folder = useFileLinkCwd();
    const path = markdownImagePath(src ?? '', folder);
    const props = { alt, title, width, height };
    return path === null ? (
        <img {...props} src={src || undefined} loading="lazy" referrerPolicy="no-referrer" />
    ) : (
        <LocalImage key={path} {...props} path={path} />
    );
}

const DOCUMENT_COMPONENTS = { img: DocumentImage };

export function FileMarkdown({ text }: { text: string }) {
    const { t } = useTranslation('panels');
    const document = useMemo(() => parseMarkdownDocument(text), [text]);
    return (
        <div className="file-markdown">
            {document.rows !== null && document.rows.length > 0 && (
                <div className="mb-6 overflow-x-auto rounded-md border border-border">
                    <table className="w-full border-collapse text-left text-xs">
                        <caption className="border-b border-border bg-surface-sunken px-3 py-2 text-left font-medium text-text-muted">
                            {t('file.markdown.frontmatter')}
                        </caption>
                        <tbody>
                            {document.rows.map(([key, value]) => (
                                <tr key={key} className="border-b border-border last:border-b-0">
                                    <th scope="row" className="w-1/4 min-w-28 px-3 py-2 align-top font-medium break-words">
                                        {key}
                                    </th>
                                    <td className="px-3 py-2 align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {document.invalid && (
                <p className="mb-3 text-xs text-text-muted" role="status">
                    {t('file.markdown.invalidFrontmatter')}
                </p>
            )}
            <Markdown text={document.body} rehypePlugins={FILE_HTML_PLUGINS} componentOverrides={DOCUMENT_COMPONENTS} />
        </div>
    );
}
