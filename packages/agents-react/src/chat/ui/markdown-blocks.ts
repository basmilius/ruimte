export interface MarkdownBlock {
    text: string;
    /* The block ends inside a code fence that has not closed yet. */
    openFence: boolean;
}

interface OpenFence {
    marker: string;
    length: number;
    indent: number;
}

const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
// Spaces and tabs only: a line that holds a no-break space is text to markdown, not a blank line.
const BLANK = /^[ \t]*$/;
// A line that continues what stood before the blank line: an indented paragraph of a list item, or
// the next item of a loose list. Splitting there would change what the markdown means.
const CONTINUES = /^([ \t]|[-*+][ \t]|\d+[.)][ \t])/;
// A reference or footnote definition may be used anywhere in the text, so a block cannot stand alone.
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
// How much deeper than its opening a closing fence may sit; deeper than that it is a line of code.
const CLOSING_INDENT = 3;
// A section title: an ATX heading, or a line of only bold text, which models write as a heading too.
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const BOLD_LINE = /^ {0,3}\*\*(?:[^*]|\*(?!\*))+\*\*:?[ \t]*$/;

/*
 * A reply cut into blocks at blank lines outside a code fence, so each block parses on its own and
 * only the one still growing is parsed again. Joined back together the blocks are the text.
 */
export const splitMarkdownBlocks = (text: string): MarkdownBlock[] => {
    if (DEFINITION.test(text)) {
        return [{ text, openFence: isFenceOpenAtEnd(text) }];
    }
    const lines = text.split('\n');
    const blocks: MarkdownBlock[] = [];
    let start = 0;
    let offset = 0;
    let fence: OpenFence | null = null;
    let afterBlank = false;

    lines.forEach((line, index) => {
        if (fence === null && afterBlank && !BLANK.test(line) && !CONTINUES.test(line)) {
            blocks.push({ text: text.slice(start, offset), openFence: false });
            start = offset;
        }
        fence = nextFence(fence, line);
        afterBlank = fence === null && BLANK.test(line) && index > 0;
        offset += line.length + 1;
    });
    blocks.push({ text: text.slice(start), openFence: fence !== null });
    return blocks;
};

/*
 * The blocks of a reply still being written that will not change any more: every block but the last.
 * A block is only known to be closed once the line after its blank line starts, since that line may
 * still turn out to continue it (a list item, an indented paragraph). A section title waits for the
 * block under it, so it never sits alone above a block that is still streaming.
 */
export const settledBlocksText = (text: string): string =>
    withoutTrailingTitles(
        splitMarkdownBlocks(text)
            .slice(0, -1)
            .map((block) => block.text)
            .join('')
    );

const withoutTrailingTitles = (text: string): string => {
    const lines = text.split('\n');
    let end = lines.length;
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index]!;
        if (BLANK.test(line)) {
            continue;
        }
        // A bold line right under a line of text continues that paragraph.
        const title = HEADING.test(line) || (BOLD_LINE.test(line) && (index === 0 || BLANK.test(lines[index - 1]!)));
        if (!title) {
            break;
        }
        end = index;
    }
    if (end === lines.length) {
        return text;
    }
    return lines
        .slice(0, end)
        .map((line) => `${line}\n`)
        .join('');
};

/* The fence a line leaves open: it opens one, closes the one that is open, or changes nothing. */
const nextFence = (fence: OpenFence | null, line: string): OpenFence | null => {
    const match = FENCE.exec(line);
    if (!match) {
        return fence;
    }
    const indent = match[1]!.length;
    const run = match[2]!;
    const rest = match[3]!;
    if (fence === null) {
        // A backtick fence's info string may not hold a backtick, or the line is inline code.
        if (run[0] === '`' && rest.includes('`')) {
            return null;
        }
        return { marker: run[0]!, length: run.length, indent };
    }
    // A closing fence carries no info string, and a line far deeper than the opening is code.
    if (run[0] === fence.marker && run.length >= fence.length && BLANK.test(rest) && indent <= fence.indent + CLOSING_INDENT) {
        return null;
    }
    return fence;
};

const isFenceOpenAtEnd = (text: string): boolean => {
    let fence: OpenFence | null = null;
    for (const line of text.split('\n')) {
        fence = nextFence(fence, line);
    }
    return fence !== null;
};
