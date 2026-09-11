import { memo, useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openFileLink, useFileLinkCwd, useFileLinkTarget, type FileRef } from '@/shell/panels/file-links';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';

type Highlighter = (code: string, lang: string, theme: 'light' | 'dark') => Promise<string>;

let highlighterPromise: Promise<Highlighter> | null = null;

// Shiki loads on the first code block, not with the app; the web bundle covers the languages a coding agent writes.
const loadHighlighter = (): Promise<Highlighter> => {
    highlighterPromise ??= import('shiki/bundle/web').then(({ codeToHtml, bundledLanguages }) => async (code, lang, theme) => {
        const language = lang in bundledLanguages ? lang : 'text';
        return codeToHtml(code, { lang: language, theme: theme === 'dark' ? 'github-dark' : 'github-light' });
    });
    return highlighterPromise;
};

const languageOf = (className: string | undefined): string => /language-([\w-]+)/.exec(className ?? '')?.[1] ?? 'text';

function CodeBlock({ code, lang }: { code: string; lang: string }) {
    const theme = useTheme((t) => t.resolved);
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadHighlighter()
            .then((highlight) => highlight(code, lang, theme))
            .then((result) => {
                if (!cancelled) {
                    setHtml(result);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [code, lang, theme]);

    if (html === null) {
        // The same shape shiki hands back, so the block does not resize once it is highlighted and
        // prose never sees a bare `pre` to paint from its own variables.
        return (
            <div className="chat-code">
                <pre>
                    <code>{code}</code>
                </pre>
            </div>
        );
    }
    return <div className="chat-code" dangerouslySetInnerHTML={{ __html: html }} />;
}

const INLINE_CODE = 'rounded-sm bg-surface-sunken px-1 py-px font-mono text-code';

/*
 * A path an agent wrote down, opened in the preview panel. It keeps the shape of the code chip it
 * would otherwise be, so a sentence full of them does not start dancing; only the color says it can
 * be clicked. `data-file-path` is what the thread's own right-click menu reads, so a link answers to
 * both ways of opening it.
 */
function FileLink({ target, className, children }: { target: FileRef; className?: string; children: ReactNode }) {
    const cwd = useFileLinkCwd();
    const limit = useSettings((s) => s.filesTabLimit);
    return (
        // `select-text` because a thread is copied as often as it is clicked, and a button is not
        // selectable on its own.
        <button
            type="button"
            className={clsx('cursor-pointer select-text', className)}
            data-file-path={target.path}
            data-file-line={target.line}
            onClick={() => openFileLink(cwd, target, limit)}
        >
            {children}
        </button>
    );
}

/* Inline code, which is a file reference often enough that it is worth asking every time. */
function InlineCode({ text }: { text: string }) {
    const target = useFileLinkTarget(text);
    if (target === null) {
        return <code className={INLINE_CODE}>{text}</code>;
    }
    return (
        <FileLink target={target} className={`${INLINE_CODE} text-accent hover:underline`}>
            {text}
        </FileLink>
    );
}

/* The path a link target spells, with the one scheme that still means a file on the daemon's machine
   taken off. A href nobody encoded is left as it is, since decoding throws on a stray percent. */
const hrefPath = (href: string): string => {
    const bare = href.replace(/^file:\/\//, '');
    try {
        return decodeURI(bare);
    } catch {
        return bare;
    }
};

/* A markdown link, which is a file when its target names no scheme of its own. */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
    const target = useFileLinkTarget(hrefPath(href ?? ''));
    if (target !== null) {
        return (
            <FileLink target={target} className="text-accent underline underline-offset-2">
                {children}
            </FileLink>
        );
    }
    return (
        <a href={href} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}

const components = {
    pre({ children }: { children?: ReactNode }) {
        return <>{children}</>;
    },
    code({ className, children }: { className?: string; children?: ReactNode }) {
        const text = String(children ?? '');
        // Fenced blocks end with a newline and carry a language; anything else is inline.
        if (className?.startsWith('language-') || text.includes('\n')) {
            return <CodeBlock code={text.replace(/\n$/, '')} lang={languageOf(className)} />;
        }
        return <InlineCode text={text} />;
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
        return <MarkdownLink href={href}>{children}</MarkdownLink>;
    },
    table({ children }: { children?: ReactNode }) {
        // A table wider than the column scrolls on its own instead of pushing the thread sideways.
        return (
            <div className="chat-table">
                <table>{children}</table>
            </div>
        );
    }
};

/*
 * Assistant text as the model wrote it: GitHub-flavored markdown, code highlighted off the main
 * path. Tailwind Typography sets the rhythm and `.chat-markdown` paints it in the theme's tokens.
 * `text-sm` is the size, which a node, a view and the file preview each move for themselves, and it
 * has to be a utility to outrank the one `prose-sm` brings; prose scales its own air off it in
 * `em`. `max-w-none` leaves the column width to whoever renders this.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
});
