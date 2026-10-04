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
