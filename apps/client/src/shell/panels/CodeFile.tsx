import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, WrapText } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { formatNumber } from '@/format/number';
import { DraftBar, EditorNotice } from '@/shell/panels/DraftBar';
import type { EditBlock } from '@/shell/panels/edit-gate';
import { useFileActions } from '@/shell/panels/file-actions';
import { FileEditor } from '@/shell/panels/FileEditor';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { highlightCode } from '@/shell/panels/highlight';
import { useFileEditing } from '@/shell/panels/use-file-editing';
import { useCodeTheme } from '@/state/code-theme';
import { useFiles } from '@/state/files';
import { BTN_GROUP } from '@/ui/classes';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Pill } from '@/ui/Pill';
import { Separator } from '@/ui/Separator';
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
 * Past this a file is drawn as plain text. Chunks highlight themselves only as they come near the
 * viewport, so the cost is paid a screen at a time, but a generated file of a hundred thousand
 * lines is one nobody reads for its colors and every scroll through it would ask shiki again.
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

/*
 * The line and the column a click landed on, read off the lines the viewer drew, so the editor that
 * takes over puts its cursor there. Null off the text.
 */
const pointInCode = (event: MouseEvent): { line: number; column: number } | null => {
    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    const node = caret?.offsetNode ?? (event.target as Node | null);
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    const line = element?.closest('.line') ?? null;
    const chunk = line?.closest<HTMLElement>('[data-start]') ?? null;
    if (line === null || chunk === null) {
        return null;
    }
    let column = 1;
    if (caret !== null && line.contains(caret.offsetNode)) {
        const before = document.createRange();
        before.setStart(line, 0);
        before.setEnd(caret.offsetNode, caret.offset);
        column = before.toString().length + 1;
    }
    return { line: Number(chunk.dataset.start) + [...chunk.querySelectorAll('.line')].indexOf(line), column };
};

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
 * Any text file, highlighted a block at a time, and the editor over the same place once a person
 * clicks into the text or presses Edit. Reading stays the default: a viewer costs next to nothing
 * on a canvas of many files, and a stray click never changes a file an agent is working on.
 */
export function CodeFile({ path, read, toolbarExtra }: CodeFileProps) {
    const { t } = useTranslation('panels');
    const theme = useCodeTheme();
    const [wrap, setWrap] = useState(false);
    const container = useRef<HTMLDivElement>(null);
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
    const editorUp = editing.wanted && editing.engine !== null;
    const disk = useMemo(() => ({ text: read.text, mtime: read.mtime }), [read]);

    const scrollTop = (): number => container.current?.querySelector('.file-code')?.scrollTop ?? 0;

    /* A plain click, not the end of a drag that selected something, and not a double click that selects a word. */
    const onViewerClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
        if (editing.block !== null || event.button !== 0 || event.detail !== 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        if (window.getSelection()?.isCollapsed === false) {
            return;
        }
        const at = pointInCode(event.nativeEvent) ?? { line: lineCount, column: 1 };
        editing.begin({ ...at, scrollTop: event.currentTarget.scrollTop });
    };

    const onEditToggle = (): void => {
        if (editing.wanted) {
            editing.stop();
            return;
        }
        const top = scrollTop();
        editing.begin({ line: Math.floor(top / LINE_HEIGHT) + 1, column: 1, scrollTop: top });
    };

    const editLabel =
        editing.block !== null
            ? t(BLOCK_LABELS[editing.block], { lines: formatNumber(HIGHLIGHT_MAX_LINES) })
            : editing.wanted
              ? t('file.edit.stop')
              : t('file.edit.start');

    return (
        <div ref={container} className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                {plain && (
                    <Tooltip label={t('file.code.plainReason', { lines: formatNumber(HIGHLIGHT_MAX_LINES) })}>
                        <Pill>{t('file.code.plainText')}</Pill>
                    </Tooltip>
                )}
                {toolbarExtra}
                {toolbarExtra !== undefined && <Separator />}
                <div className={BTN_GROUP}>
                    <FileToolbarToggle icon={Pencil} label={editLabel} active={editing.wanted} disabled={editing.block !== null} onClick={onEditToggle} />
                    <FileToolbarToggle
                        icon={WrapText}
                        label={wrap ? t('file.code.unwrap') : t('file.code.wrap')}
                        active={wrap}
                        onClick={() => setWrap(!wrap)}
                    />
                </div>
            </FileToolbar>
            <DraftBar endpointId={editing.endpointId} path={path} />
            {editing.wanted && editing.loadFailed && (
                <EditorNotice message={t('file.edit.loadFailed')}>
                    <Button variant="secondary" size="sm" onClick={editing.retryLoad}>
                        {t('common:action.retry')}
                    </Button>
                </EditorNotice>
            )}
            {editorUp && editing.engine !== null ? (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[path, editing.engine]} className="min-h-0 grow">
                    <FileEditor
                        engine={editing.engine}
                        endpointId={editing.endpointId}
                        path={path}
                        disk={disk}
                        language={read.language}
                        wrap={wrap}
                        readOnly={editing.readOnly}
                        start={editing.start}
                        focused={editing.focused}
                        reveal={reveal}
                    />
                </ErrorBoundary>
            ) : (
                <FileScroll className="file-code" data-wrap={wrap} onClick={onViewerClick}>
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
    );
}
