import { matchesIn, type TextMatch } from '@/find/query';

/*
 * The text a reader sees in a rendered element, as one string, with the way back from an offset in it
 * to the text node it came from. A match may run over several nodes (`<strong>side</strong>bar`),
 * which is why the matcher reads the joined string and not node by node.
 */
export interface DomText {
    text: string;
    nodes: Text[];
    /* Where each node's text starts in `text`; only grows. */
    starts: number[];
}

// A new block starts a new line, so the last word of one paragraph never runs into the first of the next.
const BLOCK_TAGS = new Set([
    'ADDRESS',
    'ARTICLE',
    'BLOCKQUOTE',
    'BR',
    'DD',
    'DIV',
    'DL',
    'DT',
    'FIGCAPTION',
    'FIGURE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HR',
    'LI',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'TABLE',
    'TD',
    'TH',
    'TR',
    'UL'
]);

// What never shows as text, and a screen reader's heading the eye never sees.
const SKIPPED = 'script, style, template, .sr-only';

export const readDomText = (root: Element): DomText => {
    const nodes: Text[] = [];
    const starts: number[] = [];
    let text = '';
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node instanceof Element && node.matches(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    let node = walker.nextNode();
    while (node !== null) {
        if (node instanceof Text) {
            nodes.push(node);
            starts.push(text.length);
            text += node.data;
        } else if (node instanceof Element && BLOCK_TAGS.has(node.tagName) && text !== '' && !text.endsWith('\n')) {
            text += '\n';
        }
        node = walker.nextNode();
    }
    return { text, nodes, starts };
};

/* The node an offset falls in and where in it; an offset on a seam belongs to the node it starts. */
export const locateOffset = (starts: readonly number[], offset: number): { index: number; offset: number } => {
    let low = 0;
    let high = starts.length - 1;
    let found = 0;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (starts[middle]! <= offset) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return { index: found, offset: offset - (starts[found] ?? 0) };
};

/* The ranges of the matches, for the page's highlights and for scrolling one into view. */
export const rangesOf = (dom: DomText, matches: readonly TextMatch[]): Range[] => {
    if (dom.nodes.length === 0) {
        return [];
    }
    const document = dom.nodes[0]!.ownerDocument;
    return matches.map((match) => {
        const start = locateOffset(dom.starts, match.start);
        // The end is exclusive, so it is found as the last character of the match and stepped past.
        const end = locateOffset(dom.starts, match.end - 1);
        const range = document.createRange();
        const startNode = dom.nodes[start.index]!;
        const endNode = dom.nodes[end.index]!;
        range.setStart(startNode, Math.min(start.offset, startNode.length));
        range.setEnd(endNode, Math.min(end.offset + 1, endNode.length));
        return range;
    });
};

export const findRanges = (root: Element, pattern: RegExp): Range[] => {
    const dom = readDomText(root);
    return rangesOf(dom, matchesIn(dom.text, pattern));
};
