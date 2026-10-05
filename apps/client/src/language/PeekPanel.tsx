import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import { FileIcon, IconButton, Tooltip } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { highlightDocument } from '@/shell/panels/highlight';
import { basenameOf } from '@/shell/panels/files-tree';
import { useCodeTheme } from '@/state/code-theme';
import type { EditorLanguage } from './editor-language';
import { shikiLanguageOfPath } from './language-ids';
import { PathText } from './PathText';
import { PEEK_HEIGHT } from './peek';
import { distinguishingFolders, visualColumnOf, type NameRange, type PeekPlace } from './peek-model';
import type { PeekView } from './popups';

const TAB_SIZE = 4;
const CODE =
    'font-mono text-(length:--code-font-size) [tab-size:4] [&_.line]:block [&_.line]:h-(--code-line-height) [&_.line]:leading-(--code-line-height) [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:p-0 [&_pre]:whitespace-pre [&_code]:font-mono';

/* The code around the active reference, drawn like the editor's own rows: its gutter, the line the reference is on and the name marked. */
function Preview({ view }: { view: PeekView }) {
    const theme = useCodeTheme();
    const scroller = useRef<HTMLDivElement>(null);
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

    useEffect(() => {
        scroller.current?.scrollTo(0, 0);
    }, [preview]);

    if (preview === null) {
        return <div className="min-w-0 flex-1" />;
    }
    const lines = preview.text.split('\n');
    const name = preview.name === null ? null : columnsOf(lines[preview.active] ?? '', preview.name);
    return (
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-auto pt-1">
            <div className="relative flex min-w-max">
                <div
                    className="absolute inset-x-0 bg-surface-hover"
                    style={{ top: `calc(${preview.active} * var(--code-line-height))`, height: 'var(--code-line-height)' }}
                />
                <div className="sticky left-0 z-10 w-16 shrink-0 pr-4 text-right font-mono text-(length:--code-font-size) text-text-faint select-none">
                    {lines.map((_, index) => (
                        <div
                            key={index}
                            className={`h-(--code-line-height) leading-(--code-line-height) ${index === preview.active ? 'bg-surface-hover text-text' : 'bg-surface'}`}
                        >
                            {preview.startLine + index + 1}
                        </div>
                    ))}
                </div>
                <div className="relative">
                    {name !== null && (
                        <div
                            className="absolute rounded-sm bg-(--editor-occurrence) font-mono text-(length:--code-font-size)"
                            style={{
                                top: `calc(${preview.active} * var(--code-line-height))`,
                                height: 'var(--code-line-height)',
                                left: `${name.start}ch`,
                                width: `${name.end - name.start}ch`
                            }}
                        />
                    )}
                    {html?.key === key ? (
                        <div className={`relative ${CODE}`} dangerouslySetInnerHTML={{ __html: html.html }} />
                    ) : (
                        <div className={`relative ${CODE} whitespace-pre`}>{preview.text}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* The name's stretch of a line in monospace columns, which is what the code is laid out in. */
function columnsOf(line: string, name: NameRange): NameRange {
    const start = visualColumnOf(line, name.start, TAB_SIZE);
    return { start, end: visualColumnOf(line, name.end, TAB_SIZE) };
}

function relativeTo(path: string, folder: string): string {
    return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

function folderOf(path: string): string {
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/* A line of code with its name in the text color and the rest muted. */
function PlaceText({ place }: { place: PeekPlace }) {
    if (place.text === '') {
        return <span className="min-w-0 truncate text-text-muted">{`:${place.line + 1}`}</span>;
    }
    const { name } = place;
    if (name === null) {
        return <span className="min-w-0 truncate text-text-muted">{place.text}</span>;
    }
    return (
        <span className="min-w-0 truncate text-text-muted">
            {place.text.slice(0, name.start)}
            <span className="font-semibold text-text">{place.text.slice(name.start, name.end)}</span>
            {place.text.slice(name.end)}
        </span>
    );
}

function Places({ language, view }: { language: EditorLanguage; view: PeekView }) {
    const { t } = useTranslation('panels');
    const activeRow = useRef<HTMLButtonElement>(null);
    const folder = language.project.folder;
    const paths = useMemo(() => view.files.map((file) => relativeTo(fileUriToPath(file.uri) ?? file.uri, folder)), [view.files, folder]);
    const folders = useMemo(() => distinguishingFolders(paths), [paths]);

    useEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [view.active]);

    return (
        <div className="w-1/3 shrink-0 overflow-y-auto border-l border-border py-1">
            {view.files.map((file, fileIndex) => {
                const collapsed = view.collapsed.includes(file.uri);
                return (
                    <div key={file.uri}>
                        <Tooltip label={paths[fileIndex]!} side="left">
                            <div className="flex h-[22px] items-center pr-3 pl-1 text-xs">
                                <IconButton
                                    icon={collapsed ? ChevronRight : ChevronDown}
                                    size="2xs"
                                    label={t(collapsed ? 'language.peek.expand' : 'language.peek.collapse')}
                                    onClick={() => language.peek.toggleFile(file.uri)}
                                />
                                <FileIcon path={paths[fileIndex]!} size={14} className="ml-0.5 shrink-0" />
                                <span className="ml-1 max-w-full shrink-0 truncate">{basenameOf(paths[fileIndex]!)}</span>
                                <span className="ml-1.5 shrink-0 text-text-muted">{formatNumber(file.places.length)}</span>
                                {folders[fileIndex] !== '' && <span className="ml-2 min-w-0 flex-1 truncate text-text-faint">{folders[fileIndex]}</span>}
                            </div>
                        </Tooltip>
                        {!collapsed &&
                            file.places.map((place) => (
                                <button
                                    key={place.id}
                                    ref={place.id === view.active ? activeRow : undefined}
                                    type="button"
                                    data-active={place.id === view.active}
                                    className="flex h-[22px] w-full items-center pr-3 pl-9 text-left font-mono text-code hover:bg-surface-hover data-[active=true]:bg-accent-soft"
                                    onClick={() => (place.id === view.active ? language.peek.go(place.id) : language.peek.select(place.id))}
                                    onDoubleClick={() => language.peek.go(place.id)}
                                >
                                    <PlaceText place={place} />
                                </button>
                            ))}
                    </div>
                );
            })}
        </div>
    );
}

/*
 * The references of a name drawn in the row the editor leaves under the line: the file of the active
 * reference and where it is, the code around it on the left and every place on the right. It lives in a
 * portal into the editor's own row, which the editor makes again when it scrolls back into view. It has
 * the editor's own ground and no edge of its own, so it reads as part of the file.
 */
export function PeekPanel({ language, view }: { language: EditorLanguage; view: PeekView }) {
    const { t } = useTranslation('panels');
    const active = view.files.flatMap((file) => file.places).find((place) => place.id === view.active);
    const path = active === undefined ? null : fileUriToPath(active.location.uri);
    const folder = language.project.folder;
    const shown = path === null ? '' : folderOf(relativeTo(path, folder));
    if (view.container === null) {
        return null;
    }
    return createPortal(
        <div
            className="flex flex-col bg-surface pt-[2px] font-sans text-xs text-text"
            style={{ height: PEEK_HEIGHT }}
            onPointerDown={(event) => event.preventDefault()}
        >
            <div className="peek-hatch h-[14px]" />
            <div className="flex h-[31px] shrink-0 items-center gap-2 border-b border-border pr-2 pl-3 text-sm">
                <span className="shrink-0 font-medium">{path === null ? '' : basenameOf(path)}</span>
                <PathText path={shown} className="text-text-muted" />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <span className="text-text-muted">
                        {t(view.kind === 'definitions' ? 'language.peek.definitions' : 'language.peek.references', {
                            count: view.count,
                            formatted: formatNumber(view.count)
                        })}
                    </span>
                    <IconButton icon={X} size="xs" label={t('language.peek.close')} onClick={() => language.peek.close()} />
                </div>
            </div>
            <div className="flex h-[180px] shrink-0">
                <Preview view={view} />
                <Places language={language} view={view} />
            </div>
            <div className="peek-hatch h-[14px]" />
        </div>,
        view.container
    );
}
