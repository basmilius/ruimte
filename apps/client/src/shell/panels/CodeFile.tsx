import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WrapText } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { FileScroll } from '@/shell/panels/FileScroll';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { highlightCode } from '@/shell/panels/highlight';
import { useTheme } from '@/state/theme';
import { Separator } from '@/ui/Separator';

// One screen of code, near enough. Small enough to highlight without a stutter, large enough that a
// long file is a handful of blocks instead of thousands.
const CHUNK_LINES = 400;

// `--text-code--line-height` in `styles.css`. A chunk that has not been mounted reserves this per
// line, so the scrollbar is the right length from the first paint.
const LINE_HEIGHT = 20;

// How far outside the viewport a chunk starts drawing itself, so scrolling never waits for it.
const LOOK_AHEAD = '600px';

interface ChunkProps {
    code: string;
    lines: number;
    /* The line number this chunk opens on, one-based. */
    start: number;
    language: string;
    theme: 'light' | 'dark';
}

/*
 * A block of the file. It draws nothing until it comes near the viewport, then plain text, then the
 * highlighted version once shiki answers. Every step has the same line count and line height, so the
 * page below it never moves.
 */
function CodeChunk({ code, lines, start, language, theme }: ChunkProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(start === 1);
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        const element = ref.current;
        if (near || !element) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNear(true);
                }
            },
            { rootMargin: LOOK_AHEAD }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [near]);

    useEffect(() => {
        if (!near) {
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
    const theme = useTheme((t) => t.resolved);
    const [wrap, setWrap] = useState(false);
    const language = read.language ?? 'text';

    const chunks = useMemo(() => {
        // A file that ends in a newline has no last line, only a last line break.
        const lines = read.text.replace(/\n$/, '').split('\n');
        const blocks: { start: number; code: string; lines: number }[] = [];
        for (let i = 0; i < lines.length; i += CHUNK_LINES) {
            const block = lines.slice(i, i + CHUNK_LINES);
            blocks.push({ start: i + 1, code: block.join('\n'), lines: block.length });
        }
        return blocks;
    }, [read.text]);

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                {toolbarExtra}
                {toolbarExtra !== undefined && <Separator />}
                <FileToolbarToggle icon={WrapText} label={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'} active={wrap} onClick={() => setWrap(!wrap)} />
            </FileToolbar>
            <FileScroll className="file-code" data-wrap={wrap}>
                {chunks.map((chunk) => (
                    <CodeChunk key={chunk.start} code={chunk.code} lines={chunk.lines} start={chunk.start} language={language} theme={theme} />
                ))}
            </FileScroll>
        </div>
    );
}
