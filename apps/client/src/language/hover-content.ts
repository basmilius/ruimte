import type { EditorRange } from '@ruimte/smart-editor';
import type { Hover, Location, LocationLink, MarkedString, NavigationResult } from '@ruimte/smart-editor-lsp';

export interface SignatureBlock {
    readonly language: string;
    readonly code: string;
}

/* What a server said about a symbol: its signature as code, then prose as markdown. */
export interface HoverText {
    readonly signatures: readonly SignatureBlock[];
    readonly markdown: string;
}

const FENCE = /^```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/;

/*
 * The leading fenced blocks of a markdown text as signatures, and what follows them, minus the rule
 * between the two that language servers draw, as the prose. A block further down, such as an example
 * in the documentation, stays where it is.
 */
export function splitSignatures(markdown: string): HoverText {
    const signatures: SignatureBlock[] = [];
    let rest = markdown.replace(/^\s+/, '');
    for (let match = FENCE.exec(rest); match !== null; match = FENCE.exec(rest)) {
        signatures.push({ language: match[1] || 'text', code: match[2]! });
        rest = rest.slice(match[0].length).replace(/^\s+/, '');
    }
    return { signatures, markdown: rest.replace(/^(?:-{3,}|\*{3,})\s*(?:\n|$)/, '').trim() };
}

function markedStringText(content: MarkedString): HoverText {
    if (typeof content !== 'string') {
        return { signatures: [{ language: content.language || 'text', code: content.value }], markdown: '' };
    }
    return splitSignatures(content);
}

/* The text of a hover, whichever of the three shapes the protocol allows it in. */
export function hoverTextOf(hover: Hover): HoverText {
    const { contents } = hover;
    if (Array.isArray(contents)) {
        const parts = contents.map(markedStringText);
        return {
            signatures: parts.flatMap((part) => part.signatures),
            markdown: parts
                .map((part) => part.markdown)
                .filter(Boolean)
                .join('\n\n')
        };
    }
    if (typeof contents === 'string' || 'language' in contents) {
        return markedStringText(contents);
    }
    // Plain text is text, and not markdown that happens to have underscores in it.
    return contents.kind === 'plaintext'
        ? { signatures: [], markdown: contents.value.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1').trim() }
        : splitSignatures(contents.value);
}

export function isEmptyHover(text: HoverText): boolean {
    return text.signatures.length === 0 && text.markdown === '';
}

function isLink(entry: Location | LocationLink): entry is LocationLink {
    return 'targetUri' in entry;
}

/* Where a navigation result leads, as plain locations: the part of a link that names the symbol is the one to land on. */
export function locationsOf(result: NavigationResult): Location[] {
    if (result === null) {
        return [];
    }
    const list = Array.isArray(result) ? (result as (Location | LocationLink)[]) : [result];
    return list.map((entry) => (isLink(entry) ? { uri: entry.targetUri, range: entry.targetSelectionRange } : entry));
}

export function sameRange(left: EditorRange, right: EditorRange): boolean {
    return (
        left.start.line === right.start.line &&
        left.start.character === right.start.character &&
        left.end.line === right.end.line &&
        left.end.character === right.end.character
    );
}

/* One `@tag` of a docblock, the way a server writes it into a hover: `_@since_ 1.0` or `*@param* `name` — what it is`. */
export interface DocTag {
    readonly name: string;
    readonly markdown: string;
}

const TAG_LINE = /^(?:_@([\w-]+)_|\*@([\w-]+)\*|@([\w-]+))(?:\s+|$)([\s\S]*)$/;

/* Tags whose text is a block of its own, which a row of the tag list has no room for. */
const BLOCK_TAGS = new Set(['example']);

/*
 * The docblock tags of hover prose apart from the rest, so a card can list them as rows instead of a
 * paragraph each. Only a paragraph that holds nothing but tag lines is taken; prose that mentions an
 * `@` stays prose.
 */
export function splitDocTags(markdown: string): { readonly markdown: string; readonly tags: readonly DocTag[] } {
    const tags: DocTag[] = [];
    const kept: string[] = [];
    for (const paragraph of markdown.split(/\n{2,}/)) {
        const lines = paragraph.split('\n');
        const matches = lines.map((line) => TAG_LINE.exec(line.trim()));
        const names = matches.map((match) => (match === null ? null : (match[1] ?? match[2] ?? match[3])!));
        if (paragraph.trim() === '' || names.some((name) => name === null || BLOCK_TAGS.has(name))) {
            kept.push(paragraph);
            continue;
        }
        matches.forEach((match, index) => {
            // The TypeScript server puts a dash between a tag, its parameter and its text.
            const text = match![4]!.replace(/^[—–-]\s*/, '').replace(/^(`[^`]+`)\s+[—–-]\s+/, '$1 ');
            tags.push({ name: names[index]!, markdown: text.trim() });
        });
    }
    // By name, and in the order written within one name, so parameters keep the order of the signature.
    return { markdown: kept.join('\n\n').trim(), tags: tags.toSorted((left, right) => left.name.localeCompare(right.name)) };
}

/* One symbol of a hover. A server can describe several at once, such as a class and its constructor. */
export interface HoverSection {
    /* The qualified name a server heads the section with, when it gives one. */
    readonly title: string | null;
    readonly signatures: readonly SignatureBlock[];
    readonly markdown: string;
    readonly tags: readonly DocTag[];
}

const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m;
const TITLE = /^(?:__(.+)__|\*\*(.+)\*\*)\s*(?:\n|$)/;
const ANY_FENCE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/;

/* The PHP server opens every snippet with a tag the reader does not need to see. */
function withoutOpenTag(block: SignatureBlock): SignatureBlock {
    return { language: block.language, code: block.code.replace(/^<\?php\s*\n/, '') };
}

const HTML_CODE = /<(code|pre)>([\s\S]*?)<\/\1>/g;
const INLINE_TAG = /\{@(see|link|linkplain)\s+([^}\s]+)(?:\s+([^}]+?))?\s*\}/g;

function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&');
}

function dedent(text: string): string {
    const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
    const indents = lines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
    const common = indents.length === 0 ? 0 : Math.min(...indents);
    return lines.map((line) => line.slice(common)).join('\n');
}

/*
 * What a docblock writes for a reader of its source, written for one of a hover: a `<code>` or `<pre>`
 * example as a block in the symbol's language, and an inline `{@see Name}` or `{@link Name label}` as
 * the name in code. Servers pass both on as they are, and markdown would show the tags as text.
 */
export function docblockMarkdown(markdown: string, language: string): string {
    return markdown
        .replace(HTML_CODE, (_match, _tag: string, body: string) => {
            const code = decodeEntities(body);
            return code.includes('\n') ? `\n\n\`\`\`${language}\n${dedent(code)}\n\`\`\`\n\n` : `\`${code.trim()}\``;
        })
        .replace(INLINE_TAG, (_match, _tag: string, target: string, label: string | undefined) => (label === undefined ? `\`${target}\`` : label))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/* Markdown cut at its fenced blocks, so a card can draw the blocks as compactly as its signatures. */
export type MarkdownPart = { readonly kind: 'prose'; readonly text: string } | { readonly kind: 'code'; readonly block: SignatureBlock };

export function markdownParts(markdown: string): MarkdownPart[] {
    const parts: MarkdownPart[] = [];
    let rest = markdown;
    for (let match = ANY_FENCE.exec(rest); match !== null; match = ANY_FENCE.exec(rest)) {
        const prose = rest.slice(0, match.index).trim();
        if (prose !== '') {
            parts.push({ kind: 'prose', text: prose });
        }
        parts.push({ kind: 'code', block: { language: match[1] || 'text', code: match[2]! } });
        rest = rest.slice(match.index + match[0].length);
    }
    if (rest.trim() !== '') {
        parts.push({ kind: 'prose', text: rest.trim() });
    }
    return parts;
}

/* The title is drawn as text, so the escapes that kept it from reading as markdown come off: `A\\B::\_\_construct` is `A\B::__construct`. */
function unescapeMarkdown(text: string): string {
    return text.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');
}

function sectionOf(chunk: string, leading: readonly SignatureBlock[]): HoverSection {
    let rest = chunk.trim();
    const title = TITLE.exec(rest);
    if (title !== null) {
        rest = rest.slice(title[0].length).trim();
    }
    const signatures = [...leading];
    // A section's own snippet is its first block; one further down after the prose, such as an example, stays prose.
    const fence = ANY_FENCE.exec(rest);
    if (fence !== null && !/@example/.test(rest.slice(0, fence.index))) {
        signatures.push({ language: fence[1] || 'text', code: fence[2]! });
        rest = (rest.slice(0, fence.index) + rest.slice(fence.index + fence[0].length)).trim();
    }
    const doc = splitDocTags(docblockMarkdown(rest, signatures[0]?.language ?? 'text'));
    return {
        title: title === null ? null : unescapeMarkdown((title[1] ?? title[2])!.trim()),
        signatures: signatures.map(withoutOpenTag),
        markdown: doc.markdown,
        tags: doc.tags
    };
}

/* The symbols of a hover apart, split where a server draws a rule between them, each described once. */
export function hoverSectionsOf(text: HoverText): HoverSection[] {
    const chunks = text.markdown === '' ? [''] : text.markdown.split(RULE);
    const sections = chunks.map((chunk, index) => sectionOf(chunk, index === 0 ? text.signatures : []));
    const seen = new Set<string>();
    return sections.filter((section) => {
        const empty = section.title === null && section.signatures.length === 0 && section.markdown === '' && section.tags.length === 0;
        const key = JSON.stringify([section.title, section.signatures, section.markdown]);
        if (empty || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
