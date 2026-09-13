export interface MarkdownBlock {
    text: string;
    /* The block ends inside a code fence that has not closed yet. */
    openFence: boolean;
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const BLANK = /^\s*$/;
// A line that continues what stood before the blank line: an indented paragraph of a list item, or
// the next item of a loose list. Splitting there would change what the markdown means.
const CONTINUES = /^(\s|[-*+]\s|\d+[.)]\s)/;
// A reference or footnote definition may be used anywhere in the text, so a block cannot stand alone.
const DEFINITION = /^\s{0,3}\[[^\]]+\]:/m;

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
    let fence: { marker: string; length: number } | null = null;
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

/* The fence a line leaves open: it opens one, closes the one that is open, or changes nothing. */
const nextFence = (fence: { marker: string; length: number } | null, line: string): { marker: string; length: number } | null => {
    const match = FENCE.exec(line);
    if (!match) {
        return fence;
    }
    const run = match[1]!;
    const rest = match[2]!;
    if (fence === null) {
        // A backtick fence's info string may not hold a backtick, or the line is inline code.
        if (run[0] === '`' && rest.includes('`')) {
            return null;
        }
        return { marker: run[0]!, length: run.length };
    }
    if (run[0] === fence.marker && run.length >= fence.length && BLANK.test(rest)) {
        return null;
    }
    return fence;
};

const isFenceOpenAtEnd = (text: string): boolean => {
    let fence: { marker: string; length: number } | null = null;
    for (const line of text.split('\n')) {
        fence = nextFence(fence, line);
    }
    return fence !== null;
};
