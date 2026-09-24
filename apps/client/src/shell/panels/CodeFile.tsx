import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FsReadText } from '@ruimte/contracts';
import type { Editor } from '@ruimte/editor';
import { FindBar } from '@/find/FindBar';
import { useFind } from '@/find/use-find';
import { formatNumber } from '@/format/number';
import { DraftBar, EditorNotice } from '@/shell/panels/DraftBar';
import type { EditBlock } from '@/shell/panels/edit-gate';
import { useFileActions } from '@/shell/panels/file-actions';
import { FileEditor } from '@/shell/panels/FileEditor';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar } from '@/shell/panels/FileToolbar';
import { highlightCode } from '@/shell/panels/highlight';
import { useEditorFind } from '@/shell/panels/use-editor-find';
import { useFileEditing } from '@/shell/panels/use-file-editing';
import { useCodeTheme } from '@/state/code-theme';
import { useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

// One screen of code, near enough. Small enough to highlight without a stutter, large enough that a
// long file is a handful of blocks instead of thousands.
const CHUNK_LINES = 400;

// `--text-code--line-height` in `styles.css`. A chunk that has not been mounted reserves this per
// line, so the scrollbar is the right length from the first paint.
const LINE_HEIGHT = 20;

// How far outside the viewport a chunk starts drawing itself, so scrolling never waits for it.
const LOOK_AHEAD = '600px';

// How long the line a link asked for stays marked. Long enough to find it, short enough to forget.
const FLASH_MS = 1600;

/*
 * Past this a file is plain text and read only, in the viewer and the editor alike. A generated file
 * of a hundred thousand lines is one nobody reads for its colors, and Monaco would tokenize all of it
 * in the background and hand all of it to a language service.
 */
const HIGHLIGHT_MAX_LINES = 20000;

interface ChunkProps {
    code: string;
    lines: number;
    /* The line number this chunk opens on, one-based. */
    start: number;
    /* Null in a file too long to highlight, which draws as the plain text it falls back to anyway. */
    language: string | null;
    /* A Shiki theme id. */
    theme: string;
    /* The line this chunk was asked to bring into view, one-based, when the ask landed in it. */
    reveal?: number;
    /* Which ask that was, so the same line twice jumps twice. */
    revealNonce?: number;
}

/*
 * A block of the file. It draws nothing until it comes near the viewport, then plain text, then the
 * highlighted version once shiki answers. Every step has the same line count and line height, so the
 * page below it never moves.
 */
function CodeChunk({ code, lines, start, language, theme, reveal, revealNonce }: ChunkProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [seen, setSeen] = useState(start === 1);
    const [html, setHtml] = useState<string | null>(null);
    // A chunk the viewport never reached still draws itself when a link points into it.
    const near = seen || reveal !== undefined;

    /*
     * The line is a DOM node either way: plain text draws it as a React child, shiki hands back
     * markup this component only sets. Marking it from the outside is what works for both, and the
     * effect runs again when the highlighted version replaces the plain one under it.
     */
    useEffect(() => {
        const element = ref.current;
        if (reveal === undefined || !near || !element) {
            return;
        }
        const line = element.querySelectorAll('.line')[reveal - start];
        if (!line) {
            return;
        }
        line.scrollIntoView({ block: 'center' });
        line.classList.add('is-revealed');
        const timer = setTimeout(() => line.classList.remove('is-revealed'), FLASH_MS);
        return () => {
            clearTimeout(timer);
            line.classList.remove('is-revealed');
        };
    }, [reveal, revealNonce, near, html, start]);

    useEffect(() => {
        const element = ref.current;
        if (near || !element) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setSeen(true);
                }
            },
            { rootMargin: LOOK_AHEAD }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [near]);

    useEffect(() => {
        if (!near || language === null) {
            return;
        }
        let cancelled = false;
        highlightCode(code, language, theme)
            .then((result) => {
                if (!cancelled) {
                    setHtml(result);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [near, code, language, theme]);

    // The counter starts one line before the first, since every line increments it before it prints.
    const style = { counterReset: `line ${start - 1}`, minHeight: lines * LINE_HEIGHT };

    if (html !== null) {
        return <div ref={ref} className="file-code-chunk" data-start={start} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return (
        <div ref={ref} className="file-code-chunk" data-start={start} style={style}>
            <pre>
                <code>
                    {near &&
                        code.split('\n').map((line, index) => (
                            <span key={index} className="line">
                                {line}
                            </span>
                        ))}
                </code>
            </pre>
        </div>
    );
}

/* Why a file is read only, for the tooltip on the toolbar's pill and for typing into the editor anyway. */
const BLOCK_LABELS: Record<EditBlock, string> = {
    'outside-project': 'file.edit.outsideProject',
    'ruimte-state': 'file.edit.ruimteState',
    plain: 'file.edit.plain',
    touch: 'file.edit.touch',
    zoom: 'file.edit.zoom'
};

export interface CodeFileProps {
    /* Absolute on the daemon's machine. */
    path: string;
    read: FsReadText;
    /* Controls the file's own renderer adds to the toolbar, such as the markdown view switch. */
    toolbarExtra?: ReactNode;
}

/*
 * Any text file, as an editor. The viewer's chunks draw the same place while Monaco loads, so nothing
 * moves when it takes over, and stay for a finger, which Monaco does not take, and for an editor that
 * did not load. Where the file cannot be written from here the editor is read only and the toolbar
 * says why.
 */
export function CodeFile({ path, read, toolbarExtra }: CodeFileProps) {
    const { t } = useTranslation('panels');
    const theme = useCodeTheme();
    const wrap = useSettings((s) => s.codeWrap);
    // Where the placeholder was scrolled to, for the editor that replaces it.
    const viewerScroll = useRef(0);
    // A jump to a line is asked of a tab, so a node or a view of its own never answers one.
    const tabKey = useFileActions()?.tabKey ?? null;
    const reveal = useFiles((s) => (s.revealLine !== null && s.revealLine.key === tabKey ? s.revealLine : null));

    const { chunks, lineCount } = useMemo(() => {
        // A file that ends in a newline has no last line, only a last line break.
        const lines = read.text.replace(/\n$/, '').split('\n');
        const blocks: { start: number; code: string; lines: number }[] = [];
        for (let i = 0; i < lines.length; i += CHUNK_LINES) {
            const block = lines.slice(i, i + CHUNK_LINES);
            blocks.push({ start: i + 1, code: block.join('\n'), lines: block.length });
        }
        return { chunks: blocks, lineCount: lines.length };
    }, [read.text]);
    const plain = lineCount > HIGHLIGHT_MAX_LINES;
    const language = plain ? null : (read.language ?? 'text');
    const editing = useFileEditing(path, read, plain);
    const disk = useMemo(() => ({ text: read.text, mtime: read.mtime }), [read]);
    const readOnlyReason = editing.block === null ? null : t(BLOCK_LABELS[editing.block], { lines: formatNumber(HIGHLIGHT_MAX_LINES) });
    const [editor, setEditor] = useState<Editor | null>(null);
    const surface = useRef<HTMLDivElement>(null);
    // Only the editor can be searched; the viewer that stands in while it loads, and for a finger, cannot.
    const find = useFind(surface, editor !== null);
    const editorFind = useEditorFind(find, editor);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                {readOnlyReason !== null && (
                    <Tooltip label={readOnlyReason}>
                        <Pill>{t('file.edit.readOnly')}</Pill>
                    </Tooltip>
                )}
                {toolbarExtra}
            </FileToolbar>
            <DraftBar endpointId={editing.endpointId} path={path} />
            {!editing.viewer && editing.loadFailed && (
                <EditorNotice message={t('file.edit.loadFailed')}>
                    <Button variant="secondary" size="sm" onClick={editing.retryLoad}>
                        {t('common:action.retry')}
                    </Button>
                </EditorNotice>
            )}
            <div ref={surface} className="relative flex min-h-0 min-w-0 grow flex-col">
                {find.open && (
                    <FindBar find={find} total={editorFind.total} current={editorFind.current} invalid={editorFind.invalid} onStep={editorFind.step} />
                )}
                {!editing.viewer && editing.engine !== null ? (
                    <ErrorBoundary label={t('file.edit.failed')} resetKeys={[path, editing.engine]} className="min-h-0 grow">
                        <FileEditor
                            engine={editing.engine}
                            endpointId={editing.endpointId}
                            path={path}
                            disk={disk}
                            language={plain ? undefined : read.language}
                            wrap={wrap}
                            readOnlyReason={readOnlyReason}
                            placeholderScroll={viewerScroll}
                            focused={editing.focused}
                            reveal={reveal}
                            onEditor={setEditor}
                        />
                    </ErrorBoundary>
                ) : (
                    <FileScroll className="file-code" data-wrap={wrap} onScroll={(event) => (viewerScroll.current = event.currentTarget.scrollTop)}>
                        {chunks.map((chunk) => {
                            const inChunk = reveal !== null && reveal.line >= chunk.start && reveal.line < chunk.start + chunk.lines;
                            return (
                                <CodeChunk
                                    key={chunk.start}
                                    code={chunk.code}
                                    lines={chunk.lines}
                                    start={chunk.start}
                                    language={language}
                                    theme={theme}
                                    reveal={inChunk ? reveal.line : undefined}
                                    revealNonce={inChunk ? reveal.nonce : undefined}
                                />
                            );
                        })}
                    </FileScroll>
                )}
            </div>
        </div>
    );
}
