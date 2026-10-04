/** `end` excludes the line break and `next` is where the following line starts, so the break is `[end, next)`. */
export interface DocumentLine {
    start: number;
    end: number;
    next: number;
    text: string;
}

/*
 * A persistent AVL tree of text chunks of at most `chunkSize` UTF-16 code units. Every node knows
 * its length and its LF count, a leaf also where its LFs are, so offsets and line numbers resolve
 * without scanning.
 */
type Leaf = { readonly text: string; readonly breaks: readonly number[]; readonly length: number; readonly lines: number; readonly height: number };
type Branch = { readonly left: Node; readonly right: Node; readonly length: number; readonly lines: number; readonly height: number };
type Node = Leaf | Branch;
const chunkSize = 2048;

function leaf(text: string): Leaf | null {
    if (!text.length) {
        return null;
    }
    const breaks: number[] = [];
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
        breaks.push(index);
    }
    return { text, breaks, length: text.length, lines: breaks.length, height: 1 };
}

function branch(left: Node, right: Node): Branch {
    return { left, right, length: left.length + right.length, lines: left.lines + right.lines, height: Math.max(left.height, right.height) + 1 };
}

function balance(left: Node, right: Node): Node {
    if (left.height > right.height + 1 && 'left' in left) {
        if (left.left.height >= left.right.height) {
            return branch(left.left, branch(left.right, right));
        }
        const middle = left.right as Branch;
        return branch(branch(left.left, middle.left), branch(middle.right, right));
    }
    if (right.height > left.height + 1 && 'left' in right) {
        if (right.right.height >= right.left.height) {
            return branch(branch(left, right.left), right.right);
        }
        const middle = right.left as Branch;
        return branch(branch(left, middle.left), branch(middle.right, right.right));
    }
    return branch(left, right);
}

function join(left: Node | null, right: Node | null): Node | null {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    if ('text' in left && 'text' in right && left.length + right.length <= chunkSize) {
        return leaf(left.text + right.text);
    }
    if (left.height > right.height + 1 && 'left' in left) {
        return balance(left.left, join(left.right, right)!);
    }
    if (right.height > left.height + 1 && 'left' in right) {
        return balance(join(left, right.left)!, right.right);
    }
    return branch(left, right);
}

function split(node: Node | null, offset: number): [Node | null, Node | null] {
    if (!node || offset <= 0) {
        return [null, node];
    }
    if (offset >= node.length) {
        return [node, null];
    }
    if ('text' in node) {
        return [leaf(node.text.slice(0, offset)), leaf(node.text.slice(offset))];
    }
    if (offset < node.left.length) {
        const [before, after] = split(node.left, offset);
        return [before, join(after, node.right)];
    }
    const [before, after] = split(node.right, offset - node.left.length);
    return [join(node.left, before), after];
}

function build(text: string): Node | null {
    const leaves: Node[] = [];
    for (let offset = 0; offset < text.length; offset += chunkSize) {
        leaves.push(leaf(text.slice(offset, offset + chunkSize))!);
    }
    const tree = (from: number, to: number): Node | null => {
        if (from === to) {
            return null;
        }
        if (to - from === 1) {
            return leaves[from]!;
        }
        const middle = (from + to) >>> 1;
        return branch(tree(from, middle)!, tree(middle, to)!);
    };
    return tree(0, leaves.length);
}

function collect(node: Node | null, from: number, to: number, chunks: string[]): void {
    if (!node || from >= to) {
        return;
    }
    if ('text' in node) {
        chunks.push(node.text.slice(from, to));
        return;
    }
    if (from < node.left.length) {
        collect(node.left, from, Math.min(to, node.left.length), chunks);
    }
    if (to > node.left.length) {
        collect(node.right, Math.max(0, from - node.left.length), to - node.left.length, chunks);
    }
}

function* chunksOf(node: Node | null, from: number, to: number): Generator<string> {
    if (!node || from >= to) {
        return;
    }
    if ('text' in node) {
        yield node.text.slice(from, to);
        return;
    }
    if (from < node.left.length) {
        yield* chunksOf(node.left, from, Math.min(to, node.left.length));
    }
    if (to > node.left.length) {
        yield* chunksOf(node.right, Math.max(0, from - node.left.length), to - node.left.length);
    }
}

/** Truncates to an integer in `[0, maximum]`; anything that is not a finite number becomes 0. */
export function clampInteger(value: number, maximum: number): number {
    return Math.max(0, Math.min(maximum, Number.isFinite(value) ? Math.trunc(value) : 0));
}

/** Immutable: an edit returns a new rope and shares every branch it did not touch, which is what makes history cheap. */
export class TextRope {
    private readonly root: Node | null;

    private constructor(root: Node | null) {
        this.root = root;
    }

    static from(text: string): TextRope {
        return new TextRope(build(text));
    }
    get length(): number {
        return this.root?.length ?? 0;
    }
    get lineCount(): number {
        return (this.root?.lines ?? 0) + 1;
    }

    charAt(offset: number): string {
        if (offset < 0 || offset >= this.length) {
            return '';
        }
        let node = this.root!;
        while ('left' in node) {
            if (offset < node.left.length) {
                node = node.left;
            } else {
                offset -= node.left.length;
                node = node.right;
            }
        }
        return node.text.charAt(offset);
    }

    slice(from = 0, to = this.length): string {
        const chunks: string[] = [];
        collect(this.root, clampInteger(from, this.length), clampInteger(to, this.length), chunks);
        return chunks.join('');
    }

    replace(from: number, to: number, text: string): TextRope {
        const [before, rest] = split(this.root, from);
        const [, after] = split(rest, to - from);
        return new TextRope(join(join(before, build(text)), after));
    }

    /** Whether both ropes hold the same text in `[from, to)`, which has to be the same range of both. */
    equalsRange(other: TextRope, from: number, to: number): boolean {
        if (this.root === other.root) {
            return true;
        }
        const left = chunksOf(this.root, from, to);
        const right = chunksOf(other.root, from, to);
        let leftChunk = left.next();
        let rightChunk = right.next();
        let leftAt = 0;
        let rightAt = 0;
        while (!leftChunk.done && !rightChunk.done) {
            const length = Math.min(leftChunk.value.length - leftAt, rightChunk.value.length - rightAt);
            if (leftChunk.value.slice(leftAt, leftAt + length) !== rightChunk.value.slice(rightAt, rightAt + length)) {
                return false;
            }
            leftAt += length;
            rightAt += length;
            if (leftAt === leftChunk.value.length) {
                leftChunk = left.next();
                leftAt = 0;
            }
            if (rightAt === rightChunk.value.length) {
                rightChunk = right.next();
                rightAt = 0;
            }
        }
        return Boolean(leftChunk.done && rightChunk.done);
    }

    lineAt(offset: number): number {
        offset = clampInteger(offset, this.length);
        let node = this.root;
        let count = 0;
        if (!node) {
            return count;
        }
        while ('left' in node) {
            if (offset < node.left.length) {
                node = node.left;
            } else {
                offset -= node.left.length;
                count += node.left.lines;
                node = node.right;
            }
        }
        let low = 0;
        let high = node.breaks.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (node.breaks[middle]! < offset) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return count + low;
    }

    lineBounds(index: number): Omit<DocumentLine, 'text'> {
        index = clampInteger(index, this.lineCount - 1);
        const start = index === 0 ? 0 : this.breakAt(index - 1) + 1;
        if (index === this.lineCount - 1) {
            return { start, end: this.length, next: this.length };
        }
        const newline = this.breakAt(index);
        return { start, end: newline - (this.charAt(newline - 1) === '\r' ? 1 : 0), next: newline + 1 };
    }

    getLine(index: number): DocumentLine {
        const bounds = this.lineBounds(index);
        return { ...bounds, text: this.slice(bounds.start, bounds.end) };
    }

    private breakAt(index: number): number {
        let node = this.root!;
        let offset = 0;
        while ('left' in node) {
            if (index < node.left.lines) {
                node = node.left;
            } else {
                index -= node.left.lines;
                offset += node.left.length;
                node = node.right;
            }
        }
        return offset + node.breaks[index]!;
    }
}
