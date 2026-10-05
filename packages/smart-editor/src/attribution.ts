import type { DocumentChange } from '@ruimte/smart-editor-core';
import { mapOffset } from './offsets.ts';

/* The custom properties of the agent palette, which `styles.css` of the client defines for both themes. */
export const AGENT_COLORS = ['--agent-1', '--agent-2', '--agent-3', '--agent-4', '--agent-5', '--agent-6'] as const;

export interface AttributedLines {
    readonly id: string;
    readonly color: string;
    readonly sign?: string;
    readonly fill?: string;
}

interface Run {
    id: string;
    color: string;
    sign: string | undefined;
    fill: string | undefined;
    from: number;
    to: number;
}

/* A color washed out to a background that text stays readable on in either theme. */
export function tintValue(color: string): string {
    return `color-mix(in srgb, ${colorValue(color)} 14%, transparent)`;
}

/* The CSS value of a mark's color: `--agent-1` is the page's custom property of that name, anything else is a color as it stands. */
export function colorValue(color: string): string {
    return color.startsWith('--') ? `var(${color})` : color;
}

/*
 * The runs of lines a host attributed, anchored by offsets so they follow their text through edits. An
 * edit costs one mapping of two offsets per run, and a read works out the lines of only the runs that
 * reach the lines asked for.
 */
export class AttributionRuns {
    private runs: Run[] = [];

    get size(): number {
        return this.runs.length;
    }

    /* Marks name lines one-based and inclusive; `lineBounds` answers for the document as it is now. */
    set(
        marks: readonly { id: string; startLine: number; endLine: number; color: string; sign?: string; fill?: string }[],
        lineCount: number,
        lineBounds: (line: number) => { start: number; end: number }
    ): void {
        const clamp = (line: number): number => Math.min(lineCount, Math.max(1, Math.trunc(line) || 1)) - 1;
        this.runs = marks.map((mark) => {
            const start = clamp(mark.startLine);
            const end = Math.max(start, clamp(mark.endLine));
            return { id: mark.id, color: mark.color, sign: mark.sign, fill: mark.fill, from: lineBounds(start).start, to: lineBounds(end).end };
        });
    }

    clear(): void {
        this.runs = [];
    }

    map(changes: readonly DocumentChange[]): void {
        for (const run of this.runs) {
            run.from = mapOffset(run.from, changes);
            run.to = mapOffset(run.to, changes);
        }
    }

    /* The run on each line from `first` to `last`, zero-based, where `from` and `to` are the offsets they span; where runs overlap the one set last wins. */
    linesIn(first: number, last: number, from: number, to: number, lineOf: (offset: number) => number): Map<number, AttributedLines> {
        const lines = new Map<number, AttributedLines>();
        for (const run of this.runs) {
            if (run.to < from || run.from > to) {
                continue;
            }
            const value = { id: run.id, color: run.color, sign: run.sign, fill: run.fill };
            const end = Math.min(Math.max(lineOf(run.from), lineOf(run.to)), last);
            for (let line = Math.max(lineOf(run.from), first); line <= end; line++) {
                lines.set(line, value);
            }
        }
        return lines;
    }
}
