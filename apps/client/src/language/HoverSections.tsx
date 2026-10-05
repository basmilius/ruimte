import { useEffect, useState, type MouseEvent } from 'react';
import { Markdown } from '@ruimte/agents-react/chat/ui/Markdown';
import { Tooltip } from '@adecore/ui';
import { highlightCode } from '@/shell/panels/highlight';
import { useCodeTheme } from '@/state/code-theme';
import { hoverSectionsOf, markdownParts, type DocTag, type HoverSection, type HoverText } from './hover-content';
import { BaselineStatus } from './BaselineStatus';
import { declaredNameOf, linkTypeNames } from './symbol-links';

/* Code as the viewer colors it, plain until the grammar is in so the card never changes size under the pointer by much. */
export function Signature({ code, language, onName }: { code: string; language: string; onName?: (name: string) => void }) {
    const theme = useCodeTheme();
    const [html, setHtml] = useState<{ key: string; html: string } | null>(null);
    const key = `${language}\0${theme}\0${code}\0${onName !== undefined}`;
    // Only whether there are links goes into the highlighting; the handler is read when a name is pressed.
    const linked = onName !== undefined;

    useEffect(() => {
        let alive = true;
        highlightCode(code, language, theme)
            .then((result) => alive && setHtml({ key, html: linked ? linkTypeNames(result) : result }))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [code, language, theme, key, linked]);

    const className =
        'font-mono text-code break-words whitespace-pre-wrap [&_.line]:block [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:whitespace-pre-wrap [&_code]:font-mono';
    // One handler for every name, since the names are part of the highlighted HTML and not elements of ours.
    const follow = (event: MouseEvent<HTMLDivElement>): void => {
        const name = (event.target as HTMLElement).closest<HTMLElement>('[data-symbol]')?.dataset.symbol;
        if (name !== undefined && onName !== undefined) {
            onName(name);
        }
    };
    return html?.key === key ? (
        <div className={className} onClick={follow} dangerouslySetInnerHTML={{ __html: html.html }} />
    ) : (
        <div className={className}>{code}</div>
    );
}

/* A docblock's tags as rows: the tag once beside each run of the same tag, so a list of parameters reads as one. */
export function DocTags({ tags }: { tags: readonly DocTag[] }) {
    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs/[18px] select-text">
            {tags.map((tag, index) => (
                <div key={index} className="contents">
                    <span className="font-mono text-text-faint">{tags[index - 1]?.name === tag.name ? '' : `@${tag.name}`}</span>
                    <div className="min-w-0 break-words text-text-muted [&_.chat-markdown]:text-xs [&_code]:bg-transparent! [&_code]:p-0! [&_p]:m-0">
                        <Markdown text={tag.markdown} fileLinks={false} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/* One symbol: its qualified name muted, its signature, the prose and examples as compact blocks, and its tags as rows. Names in the signature are links only where `onName` says what a press does. */
export function SymbolSection({ section, onName }: { section: HoverSection; onName?: (name: string, declared: string | null) => void }) {
    const declared = declaredNameOf(section.signatures[0]?.code ?? '');
    const follow = onName === undefined ? undefined : (name: string): void => onName(name, declared);
    return (
        <div className="flex flex-col gap-1.5 px-3 py-2">
            {section.title !== null && <div className="truncate font-mono text-xs text-text-faint select-text">{section.title}</div>}
            {section.signatures.map((block, index) => (
                <Signature key={index} code={block.code} language={block.language} onName={follow} />
            ))}
            {section.baseline !== null && <BaselineStatus baseline={section.baseline} />}
            {markdownParts(section.markdown).map((part, index) =>
                part.kind === 'code' ? (
                    <div key={index} className="rounded-md bg-surface-sunken px-2 py-1.5">
                        <Signature code={part.block.code} language={part.block.language} onName={follow} />
                    </div>
                ) : (
                    <div key={index} className="text-text-muted select-text [&_.chat-markdown]:text-xs [&_p]:my-1">
                        <Markdown text={part.text} fileLinks={false} />
                    </div>
                )
            )}
            {section.tags.length > 0 && <DocTags tags={section.tags} />}
        </div>
    );
}

/* What a server says about a symbol as the sections of a hover card, shared by the hover and the documentation beside the suggestions. */
export function SymbolSections({ text, onName }: { text: HoverText; onName?: (name: string, declared: string | null) => void }) {
    return (
        <>
            {hoverSectionsOf(text).map((section, index) => (
                <SymbolSection key={index} section={section} onName={onName} />
            ))}
        </>
    );
}

/* PHP highlights only after its opening tag, which is put in front for the grammar and taken off again. */
function phpWithoutOpenTag(html: string): string {
    return html.replace(/<span[^>]*>&#x3C;\?<\/span><span[^>]*>php<\/span>(<span[^>]*>) /, '$1');
}

/*
 * Where a suggestion comes from, such as `use Raxos\Database\Orm\Attribute\PrimaryKey`, on one line that gives
 * way from its start, so the end of the name stays readable and a word is never cut in two. The full text is in the tooltip.
 */
export function SourceLine({ text, language }: { text: string; language: string }) {
    const theme = useCodeTheme();
    const [html, setHtml] = useState<{ key: string; html: string } | null>(null);
    const highlighted = language === 'php' && text.startsWith('use ');
    const key = `${theme}\0${text}`;

    useEffect(() => {
        if (!highlighted) {
            return;
        }
        let alive = true;
        highlightCode(`<?php ${text}`, 'php', theme)
            .then((result) => alive && setHtml({ key, html: phpWithoutOpenTag(result) }))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [highlighted, text, theme, key]);

    const className =
        'block overflow-hidden text-left font-mono text-code text-ellipsis whitespace-nowrap [direction:rtl] [&_code]:font-mono [&_pre]:m-0 [&_pre]:inline [&_pre]:bg-transparent! [&_pre]:p-0 [&_code]:inline [&_.line]:inline';
    return (
        <Tooltip label={text}>
            {highlighted && html?.key === key ? (
                <div className={className}>
                    <bdi dangerouslySetInnerHTML={{ __html: html.html }} />
                </div>
            ) : (
                <div className={`${className} text-text-muted`}>
                    <bdi>{text}</bdi>
                </div>
            )}
        </Tooltip>
    );
}
