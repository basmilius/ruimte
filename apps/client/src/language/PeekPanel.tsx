import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import { IconButton, Tooltip } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { highlightDocument } from '@/shell/panels/highlight';
import { basenameOf } from '@/shell/panels/files-tree';
import { useCodeTheme } from '@/state/code-theme';
import type { EditorLanguage } from './editor-language';
import { shikiLanguageOfPath } from './language-ids';
import { PathText } from './PathText';
import { PEEK_HEIGHT } from './peek';
import { distinguishingFolders } from './peek-model';
import type { PeekView } from './popups';

const LINE = 20;
const CODE =
    'font-mono text-code [&_.line]:block [&_.line]:h-5 [&_.line]:leading-5 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:p-0 [&_pre]:whitespace-pre [&_code]:font-mono';

/* The code around the active reference, with its line numbers and the line it is on marked. */
function Preview({ view }: { view: PeekView }) {
    const theme = useCodeTheme();
    const { preview } = view;
    const [html, setHtml] = useState<{ key: string; html: string } | null>(null);
    const path = preview === null ? null : fileUriToPath(preview.uri);
    const key = preview === null ? '' : `${theme}\0${path}\0${preview.text}`;

    useEffect(() => {
        if (preview === null) {
            return;
        }
        let alive = true;
        highlightDocument(preview.text, shikiLanguageOfPath(path ?? preview.uri), theme)
            .then((result) => alive && setHtml({ key, html: result }))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [preview, path, theme, key]);

    if (preview === null) {
        return <div className="min-w-0 flex-1" />;
    }
    const lines = preview.text.split('\n');
    return (
        <div className="relative min-w-0 flex-1 overflow-auto py-1">
            <div className="absolute inset-x-0 bg-accent-soft" style={{ top: 4 + preview.active * LINE, height: LINE }} />
            <div className="relative flex min-w-max">
                <div className="w-12 shrink-0 pr-3 text-right font-mono text-code text-text-faint select-none">
                    {lines.map((_, index) => (
                        <div key={index} className={`h-5 leading-5 ${index === preview.active ? 'text-text' : ''}`}>
                            {preview.startLine + index + 1}
                        </div>
                    ))}
                </div>
                {html?.key === key ? (
                    <div className={CODE} dangerouslySetInnerHTML={{ __html: html.html }} />
                ) : (
                    <div className={`${CODE} whitespace-pre`}>{preview.text}</div>
                )}
            </div>
        </div>
    );
}

function relativeTo(path: string, folder: string): string {
    return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

function Places({ language, view }: { language: EditorLanguage; view: PeekView }) {
    const activeRow = useRef<HTMLButtonElement>(null);
    const folder = language.project.folder;
    const paths = useMemo(() => view.files.map((file) => relativeTo(fileUriToPath(file.uri) ?? file.uri, folder)), [view.files, folder]);
    const folders = useMemo(() => distinguishingFolders(paths), [paths]);

    useEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [view.active]);

    return (
        <div className="w-[320px] shrink-0 overflow-y-auto border-l border-border py-1">
            {view.files.map((file, fileIndex) => (
                <div key={file.uri}>
                    <Tooltip label={paths[fileIndex]!} side="left">
                        <div className="flex items-center gap-2 px-3 pt-1.5 pb-0.5 text-xs">
                            <span className="max-w-full shrink-0 truncate font-medium">{basenameOf(paths[fileIndex]!)}</span>
                            {folders[fileIndex] !== '' && <span className="min-w-0 flex-1 truncate text-text-faint">{folders[fileIndex]}</span>}
                            <span className="ml-auto shrink-0 text-text-faint">{formatNumber(file.places.length)}</span>
                        </div>
                    </Tooltip>
                    {file.places.map((place) => (
                        <button
                            key={place.id}
                            ref={place.id === view.active ? activeRow : undefined}
                            type="button"
                            data-active={place.id === view.active}
                            className="flex h-6 w-full items-center gap-2 px-3 text-left font-mono text-code cursor-row"
                            onClick={() => (place.id === view.active ? language.peek.go(place.id) : language.peek.select(place.id))}
                            onDoubleClick={() => language.peek.go(place.id)}
                        >
                            <span className="min-w-0 truncate text-text-muted">{place.text === '' ? `:${place.line + 1}` : place.text}</span>
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );
}

/*
 * The references of a name drawn in the row the editor leaves under the line: the file of the active
 * reference and where it is, the code around it on the left and every place on the right. It lives in a
 * portal into the editor's own row, which the editor makes again when it scrolls back into view.
 */
export function PeekPanel({ language, view }: { language: EditorLanguage; view: PeekView }) {
    const { t } = useTranslation('panels');
    const active = view.files.flatMap((file) => file.places).find((place) => place.id === view.active);
    const path = active === undefined ? null : fileUriToPath(active.location.uri);
    const folder = language.project.folder;
    const shown = path === null ? '' : relativeTo(path, folder);
    if (view.container === null) {
        return null;
    }
    return createPortal(
        <div
            className="flex flex-col border-y border-accent bg-surface-sunken font-sans text-xs text-text"
            style={{ height: PEEK_HEIGHT }}
            onPointerDown={(event) => event.preventDefault()}
        >
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="shrink-0 font-medium">{path === null ? '' : basenameOf(path)}</span>
                <PathText path={shown} className="text-text-faint" />
                <span className="ml-auto shrink-0 text-text-muted">
                    {t(view.kind === 'definitions' ? 'language.peek.definitions' : 'language.peek.references', {
                        count: view.count,
                        formatted: formatNumber(view.count)
                    })}
                </span>
                <IconButton icon={X} size="xs" label={t('language.peek.close')} onClick={() => language.peek.close()} />
            </div>
            <div className="flex min-h-0 flex-1">
                <Preview view={view} />
                <Places language={language} view={view} />
            </div>
        </div>,
        view.container
    );
}
