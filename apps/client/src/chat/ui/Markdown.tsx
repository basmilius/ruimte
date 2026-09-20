import { memo, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { Zap } from 'lucide-react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { CHIP_IN_MESSAGE, MENTION_TONE, SKILL_TONE } from '@/chat/ui/chips';
import { CodeBlock } from '@/chat/ui/CodeBlock';
import { CodeStreamingContext } from '@/chat/ui/code-streaming';
import { splitMarkdownBlocks } from '@/chat/ui/markdown-blocks';
import { rehypeChips, type ChipOptions } from '@/chat/ui/rehype-chips';
import { rehypeFadeWords } from '@/chat/ui/rehype-fade';
import { remarkHtmlAsText } from '@/chat/ui/remark-html-as-text';
import { openFileLink, useFileLinkCwd, useFileLinkTarget, type FileRef } from '@/shell/panels/file-links';
import { useSettings } from '@/state/settings';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';

const languageOf = (className: string | undefined): string => /language-([\w-]+)/.exec(className ?? '')?.[1] ?? 'text';

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

/* For text from outside this machine, where a path in inline code is not a file anybody meant to open here. */
const plainComponents = {
    ...components,
    code({ className, children }: { className?: string; children?: ReactNode }) {
        const text = String(children ?? '');
        if (className?.startsWith('language-') || text.includes('\n')) {
            return <CodeBlock code={text.replace(/\n$/, '')} lang={languageOf(className)} />;
        }
        return <code className={INLINE_CODE}>{text}</code>;
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
        return (
            <a href={href} target="_blank" rel="noreferrer">
                {children}
            </a>
        );
    }
};

// A reply sits under the heading of its message, an `h3`, so its own headings start one level below
// that. Only `aria-level` moves. The tag stays, since the styles and a copy of the thread read it.
const REPLY_HEADING_OFFSET = 3;

const replyHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const Tag = `h${level}` as const;
    return function ReplyHeading({ children }: { children?: ReactNode }) {
        return <Tag aria-level={Math.min(6, level + REPLY_HEADING_OFFSET)}>{children}</Tag>;
    };
};

const replyComponents = {
    ...components,
    h1: replyHeading(1),
    h2: replyHeading(2),
    h3: replyHeading(3),
    h4: replyHeading(4),
    h5: replyHeading(5),
    h6: replyHeading(6)
};

/* A picked file or skill in a sent message. The glyph stands in for the sigil the text still carries. */
function Chip({ kind, value }: { kind: string; value: string }) {
    if (kind === 'skill') {
        return (
            <span className={clsx(CHIP_IN_MESSAGE, SKILL_TONE)}>
                <Icon icon={Zap} size={14} className="shrink-0 opacity-85" />
                <span className="truncate">{value}</span>
            </span>
        );
    }
    return (
        // The path is what the thread's menu opens in the preview from here.
        <span className={clsx(CHIP_IN_MESSAGE, MENTION_TONE)} data-file-path={value}>
            <FileIcon path={value} size={14} />
            <span className="truncate">{value}</span>
        </span>
    );
}

const messageComponents = {
    ...replyComponents,
    span({ children, 'data-chip': chip, 'data-value': value }: { children?: ReactNode; 'data-chip'?: string; 'data-value'?: string }) {
        if (chip === undefined || value === undefined) {
            return <span>{children}</span>;
        }
        return <Chip kind={chip} value={value} />;
    }
};

// Module constants, so a render never hands react-markdown a fresh array and makes it parse again.
const PLUGINS = [remarkGfm];
const PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks];
const MESSAGE_PLUGINS = [remarkGfm, remarkHtmlAsText, remarkBreaks];
const FADE_PLUGINS = [rehypeFadeWords];
const NO_PLUGINS: typeof FADE_PLUGINS = [];

/* One block of a reply. It renders no element of its own, so prose still sees the paragraphs as
   direct children and keeps its first and last margins. */
const ReplyBlock = memo(function ReplyBlock({ text, fade, open }: { text: string; fade: boolean; open: boolean }) {
    return (
        // A context rather than a second set of components. A component that changed would mount the
        // code block again the moment its fence closes, and it would lose the lines it already has.
        <CodeStreamingContext.Provider value={open}>
            <ReactMarkdown remarkPlugins={PLUGINS} rehypePlugins={fade ? FADE_PLUGINS : NO_PLUGINS} components={replyComponents}>
                {text}
            </ReactMarkdown>
        </CodeStreamingContext.Provider>
    );
});

/*
 * A reply in a chat thread, parsed a block at a time so a delta only parses the block that grows.
 * While it streams every new word fades in, and a fence that has not closed yet is highlighted a
 * line at a time as it grows. `arriving` fades in each block as it is added instead, for a reply
 * that is shown a block at a time.
 */
export const ReplyMarkdown = memo(function ReplyMarkdown({ text, streaming, arriving = false }: { text: string; streaming: boolean; arriving?: boolean }) {
    const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm" data-arriving={arriving || undefined}>
            {blocks.map((block, index) => (
                // Blocks only ever grow at the end, so the place of a block is a stable key.
                <ReplyBlock key={index} text={block.text} fade={streaming} open={streaming && block.openFence} />
            ))}
        </div>
    );
});

/*
 * A message a person sent. Enter meant a line break, a tag typed without backticks stays the text
 * it was, and the files and skills picked in the composer are chips again.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, mentions, skills }: { text: string; mentions?: string[]; skills?: string[] }) {
    const rehypePlugins = useMemo((): [typeof rehypeChips, ChipOptions][] => [[rehypeChips, { mentions, skills }]], [mentions, skills]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm">
            <ReactMarkdown remarkPlugins={MESSAGE_PLUGINS} rehypePlugins={rehypePlugins} components={messageComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
});

/* `breaks` is for person-authored notes; applying it to CLI markdown would change its layout. */
export const Markdown = memo(function Markdown({
    text,
    breaks = false,
    fileLinks = true,
    rehypePlugins,
    componentOverrides
}: {
    text: string;
    breaks?: boolean;
    fileLinks?: boolean;
    rehypePlugins?: Options['rehypePlugins'];
    componentOverrides?: Components;
}) {
    const renderComponents = useMemo(() => ({ ...(fileLinks ? components : plainComponents), ...componentOverrides }), [fileLinks, componentOverrides]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm">
            <ReactMarkdown remarkPlugins={breaks ? PLUGINS_WITH_BREAKS : PLUGINS} rehypePlugins={rehypePlugins} components={renderComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
});
