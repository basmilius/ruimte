import type { DocumentChange } from '@ruimte/smart-editor-core';
import type { LineToken, LineTokenizer } from './types.ts';

interface Entry {
    tokens: readonly LineToken[];
    state: unknown;
}

/* A line this long is left uncolored: a grammar can spend seconds on it, and nobody reads it in colors. */
const LONGEST_COLORED_LINE = 20000;

export interface TokenSource {
    getLineCount(): number;
    getLineText(line: number): string;
}

/*
 * What a grammar made of each line, from the top of the document down. A grammar needs the state the
 * line above it ended in, so the lines are colored in order from a frontier, and an edit moves the
 * frontier up to the changed line. Lines below it keep their old colors, shifted to where they now
 * are, until the recoloring reaches a line that ends in the state it ended in before, which is when
 * everything under it is right again.
 */
export class TokenCache {
    private tokenizer: LineTokenizer | null = null;
    private entries: (Entry | undefined)[] = [];
    /* Every line above it is colored for the text as it is now. */
    private frontier = 0;
    /* The last line the edit touched; lines below it may be told right by their old state. */
    private reusableFrom = Number.POSITIVE_INFINITY;
    /* The state the last line of the edited stretch ended in before the edit; the same state now means the lines below are right. */
    private pivotLine = -1;
    private pivotState: unknown;
    private lines: number;
    private readonly source: TokenSource;

    constructor(source: TokenSource) {
        this.source = source;
        this.lines = source.getLineCount();
    }

    get ready(): boolean {
        return this.tokenizer !== null;
    }

    /* A new tokenizer, or none, colors everything anew. */
    setTokenizer(tokenizer: LineTokenizer | null): void {
        this.tokenizer = tokenizer;
        this.lines = this.source.getLineCount();
        this.entries = [];
        this.frontier = 0;
        this.reusableFrom = Number.POSITIVE_INFINITY;
        this.pivotLine = -1;
    }

    /* How far down the document has colors that are right for the text. */
    get colored(): number {
        return this.frontier;
    }

    /* The colors of a line, or null while it has none; the old colors of a line the recoloring has not reached yet. */
    tokensOf(line: number): readonly LineToken[] | null {
        return this.entries[line]?.tokens ?? null;
    }

    /* The text changed in these batches; `lineOf` answers for the document as it is now. */
    edited(batches: readonly (readonly DocumentChange[])[], lineOf: (offset: number) => number): void {
        const lineCount = this.source.getLineCount();
        const delta = lineCount - this.lines;
        this.lines = lineCount;
        if (this.tokenizer === null) {
            return;
        }
        const first = batches[0]?.[0];
        if (first === undefined) {
            this.entries = [];
            this.frontier = 0;
            this.reusableFrom = Number.POSITIVE_INFINITY;
            this.pivotLine = -1;
            return;
        }
        const firstLine = lineOf(first.from);
        const changes = batches.length === 1 ? batches[0]! : [];
        let shift = 0;
        for (let i = 0; i < changes.length - 1; i++) {
            shift += changes[i]!.insertedLength - (changes[i]!.to - changes[i]!.from);
        }
        const last = changes.at(-1);
        const lastNew = last === undefined ? -1 : lineOf(last.from + shift + last.insertedLength);
        const lastOld = lastNew - delta;
        this.frontier = Math.min(this.frontier, firstLine);
        if (last === undefined || lastOld < firstLine || this.entries.length <= firstLine) {
            this.entries.length = Math.min(this.entries.length, firstLine);
            this.reusableFrom = Number.POSITIVE_INFINITY;
            this.pivotLine = -1;
            return;
        }
        const old = this.entries[lastOld];
        this.pivotLine = old ? lastNew : -1;
        this.pivotState = old?.state;
        this.entries.splice(firstLine, lastOld - firstLine + 1, ...new Array<undefined>(lastNew - firstLine + 1));
        this.reusableFrom = lastNew + 1;
    }

    /*
     * Colors lines from the frontier until `until` is reached, the colors are right for the rest of
     * the document, or `budget` milliseconds are spent. Returns the first line that changed, so a
     * view knows what to draw again, or null when nothing did.
     */
    advance(until: number, budget: number, now: () => number = () => performance.now()): { from: number; to: number } | null {
        const tokenizer = this.tokenizer;
        if (tokenizer === null) {
            return null;
        }
        if (tokenizer.stale?.() === true) {
            this.frontier = 0;
            this.reusableFrom = Number.POSITIVE_INFINITY;
            this.pivotLine = -1;
        }
        const count = this.source.getLineCount();
        const limit = Math.min(until, count - 1);
        const deadline = now() + budget;
        const from = this.frontier;
        while (this.frontier <= limit && this.frontier < count) {
            const line = this.frontier;
            const text = this.source.getLineText(line);
            const state = line === 0 ? null : (this.entries[line - 1]?.state ?? null);
            const previous = this.entries[line];
            let next: Entry;
            if (text.length > LONGEST_COLORED_LINE) {
                next = { tokens: [{ length: text.length, color: '', fontStyle: 0 }], state };
            } else {
                const result = tokenizer.tokenizeLine(text, state);
                next = { tokens: result.tokens, state: result.state };
            }
            this.entries[line] = next;
            this.frontier = line + 1;
            const settled =
                (line === this.pivotLine && tokenizer.sameState(this.pivotState, next.state)) ||
                (previous !== undefined && line >= this.reusableFrom && tokenizer.sameState(previous.state, next.state));
            if (settled) {
                this.frontier = this.entries.length;
                this.reusableFrom = Number.POSITIVE_INFINITY;
                this.pivotLine = -1;
                break;
            }
            if (now() > deadline) {
                break;
            }
        }
        return this.frontier > from ? { from, to: this.frontier - 1 } : null;
    }

    /* Whether lines through `line` are colored for the text as it is now. */
    covers(line: number): boolean {
        return this.frontier > line || this.frontier >= this.source.getLineCount();
    }
}
