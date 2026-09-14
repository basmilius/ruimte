import type { SyntaxNode, Tree } from '@lezer/common';

export type EnterAction = 'send' | 'newline';

export interface EnterKeys {
    shift: boolean;
    /* Cmd on macOS, Ctrl elsewhere. */
    mod: boolean;
}

/*
 * Enter sends, except inside a fence nobody has closed yet: whoever types there is still writing
 * code, and a prompt cut off halfway through a block is worth less than one more key to send it.
 */
export const enterAction = (keys: EnterKeys, inOpenFence: boolean): EnterAction => {
    if (keys.mod) {
        return 'send';
    }
    if (keys.shift || inOpenFence) {
        return 'newline';
    }
    return 'send';
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
