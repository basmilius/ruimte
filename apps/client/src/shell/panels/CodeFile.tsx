import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WrapText } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { formatNumber } from '@/format/number';
import { useFileActions } from '@/shell/panels/file-actions';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { highlightCode } from '@/shell/panels/highlight';
import { useFiles } from '@/state/files';
import { useTheme } from '@/state/theme';
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
    theme: 'light' | 'dark';
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
        return <div ref={ref} className="file-code-chunk" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return (
        <div ref={ref} className="file-code-chunk" style={style}>
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

export interface CodeFileProps {
    name: string;
    read: FsReadText;
    /* Controls the file's own renderer adds to the toolbar, such as the markdown view switch. */
    toolbarExtra?: ReactNode;
}

/* Any text file, highlighted a block at a time. */
export function CodeFile({ read, toolbarExtra }: CodeFileProps) {
    const { t } = useTranslation('panels');
    const theme = useTheme((s) => s.resolved);
    const [wrap, setWrap] = useState(false);
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

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                {plain && (
                    <Tooltip label={t('file.code.plainReason', { lines: formatNumber(HIGHLIGHT_MAX_LINES) })}>
                        <Pill>{t('file.code.plainText')}</Pill>
                    </Tooltip>
                )}
                {toolbarExtra}
                {toolbarExtra !== undefined && <Separator />}
                <FileToolbarToggle icon={WrapText} label={wrap ? t('file.code.unwrap') : t('file.code.wrap')} active={wrap} onClick={() => setWrap(!wrap)} />
            </FileToolbar>
            <FileScroll className="file-code" data-wrap={wrap}>
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
        </div>
    );
}
