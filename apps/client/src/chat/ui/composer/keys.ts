import type { SyntaxNode, Tree } from '@lezer/common';

export type EnterAction = 'send' | 'newline' | 'continue-list' | 'leave-list';

export interface EnterKeys {
    shift: boolean;
    /* Cmd on macOS, Ctrl elsewhere. */
    mod: boolean;
}

export interface ListItem {
    /* The indentation, the marker and the space after it, a task's box included. */
    prefix: string;
    /* The prefix the next item starts with: the next number, and an unchecked box for a task. */
    next: string;
    /* Nothing but the prefix on the line. */
    empty: boolean;
}

export interface EnterContext {
    inOpenFence: boolean;
    /* The list item on the caret's line, or null outside a list and in code. */
    list: ListItem | null;
    /* The caret's offset in its line. */
    column: number;
}

const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;

/* The list item a line starts, if it starts one. */
export const listItemAt = (line: string): ListItem | null => {
    const match = LIST_ITEM.exec(line);
    if (match === null) {
        return null;
    }
    const [prefix, indent, bullet, number, delimiter, space, task] = match;
    const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
    return { prefix, next: `${indent}${marker}${space}${task ? '[ ] ' : ''}`, empty: line.slice(prefix.length).trim() === '' };
};

/*
 * Enter sends, except where whoever types is still writing: inside a fence nobody has closed yet
 * it adds a line, and in a list it starts the next item, or leaves the list from an empty one, so
 * a second Enter breaks out. Shift adds a plain line and Mod sends from anywhere.
 */
export const enterAction = (keys: EnterKeys, { inOpenFence, list, column }: EnterContext): EnterAction => {
    if (keys.mod) {
        return 'send';
    }
    if (keys.shift || inOpenFence) {
        return 'newline';
    }
    if (list === null) {
        return 'send';
    }
    // A caret in front of the marker moves the item down rather than splitting its marker.
    if (column < list.prefix.length) {
        return 'newline';
    }
    return list.empty ? 'leave-list' : 'continue-list';
};

/* Whether `pos` sits inside a fenced code block that has an opening fence and no closing one yet. */
export const inOpenFence = (tree: Tree, pos: number): boolean => {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node !== null; node = node.parent) {
        if (node.name === 'FencedCode') {
            return pos > node.from && node.getChildren('CodeMark').length < 2;
        }
    }
    return false;
};

/* Whether `pos` sits in the body of a fenced code block, open or closed: below its opening line and before its end. */
export const inFenceBody = (tree: Tree, text: string, pos: number): boolean => {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node !== null; node = node.parent) {
        if (node.name === 'FencedCode') {
            const openingEnd = text.indexOf('\n', node.from);
            return openingEnd !== -1 && pos > openingEnd && (pos < node.to || node.getChildren('CodeMark').length < 2);
        }
    }
    return false;
};

/* The spaces Tab inserts at `column`, up to the next stop of four, the way a code editor lines up. */
export const tabSpaces = (column: number): string => ' '.repeat(4 - (column % 4));

const INLINE_BLOCK = /^(Paragraph|ATXHeading\d|SetextHeading\d)$/;

/*
 * Whether `pos` sits inside code: a fence, open or closed, or a code span. The parser only calls a
 * span code once it is closed, so a backtick nobody has closed yet earlier in the same paragraph
 * counts as well: whoever types after it is writing code.
 */
export const inCode = (tree: Tree, text: string, pos: number): boolean => {
    let blockFrom: number | null = null;
    for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node !== null; node = node.parent) {
        if (node.name === 'FencedCode') {
            return pos > node.from && (pos < node.to || node.getChildren('CodeMark').length < 2);
        }
        if (node.name === 'InlineCode' && pos > node.from && pos < node.to) {
            return true;
        }
        if (blockFrom === null && INLINE_BLOCK.test(node.name)) {
            blockFrom = node.from;
        }
    }
    let from = blockFrom ?? text.lastIndexOf('\n', pos - 1) + 1;
    tree.iterate({
        from,
        to: pos,
        enter: (node) => {
            if (node.name === 'InlineCode' && node.to <= pos) {
                from = Math.max(from, node.to);
            }
        }
    });
    return /(^|[^\\])`/.test(text.slice(from, pos));
};

export interface RecallContext {
    key: string;
    text: string;
    from: number;
    to: number;
    /* A prompt taken back from the thread sits in the box and nobody has edited it. */
    recalled: boolean;
}

/*
 * Which way the arrow walks through earlier prompts, or null when the arrow just moves the caret.
 * Only an empty box or an unedited recall walks, so an arrow in a prompt being written never
 * throws it away.
 */
export const recallDirection = ({ key, text, from, to, recalled }: RecallContext): -1 | 1 | null => {
    if (key === 'ArrowUp' && (text === '' || (recalled && from === 0))) {
        return -1;
    }
    if (key === 'ArrowDown' && recalled && to === text.length) {
        return 1;
    }
    return null;
};
