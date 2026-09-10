import { memo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
        return (
            <pre className="chat-code">
                <code>{code}</code>
            </pre>
        );
    }
    return <div className="chat-code" dangerouslySetInnerHTML={{ __html: html }} />;
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
        return <code className="rounded-sm bg-surface-sunken px-1 py-px font-mono text-code">{text}</code>;
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
        return (
            <a href={href} target="_blank" rel="noreferrer">
                {children}
            </a>
        );
    }
};

/* Assistant text as the model wrote it: GitHub-flavored markdown, code highlighted off the main path. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
    return (
        <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
});
