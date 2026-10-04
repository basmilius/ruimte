import type { LineToken } from './types.ts';

/* A stretch of one line, in characters from its start, that a language server colors. */
export interface SemanticSpan {
    readonly from: number;
    readonly to: number;
    readonly color: string;
    readonly fontStyle: number;
}

/*
 * The colors of a line with the spans laid over them: inside a span its color and font style replace
 * the grammar's, and everywhere else the grammar's stay. The tokens of the result add up to the line
 * as before. Spans are in order and do not overlap.
 */
export function overlayTokens(base: readonly LineToken[], spans: readonly SemanticSpan[]): LineToken[] {
    const result: LineToken[] = [];
    const push = (length: number, color: string, fontStyle: number): void => {
        if (length <= 0) {
            return;
        }
        const last = result[result.length - 1];
        if (last !== undefined && last.color === color && last.fontStyle === fontStyle) {
            result[result.length - 1] = { length: last.length + length, color, fontStyle };
        } else {
            result.push({ length, color, fontStyle });
        }
    };
    let span = 0;
    let start = 0;
    for (const token of base) {
        const end = start + token.length;
        let at = start;
        while (at < end) {
            while (span < spans.length && spans[span]!.to <= at) {
                span++;
            }
            const current = spans[span];
            if (current === undefined || current.from >= end) {
                push(end - at, token.color, token.fontStyle);
                at = end;
            } else if (current.from > at) {
                push(current.from - at, token.color, token.fontStyle);
                at = current.from;
            } else {
                const stop = Math.min(end, current.to);
                push(stop - at, current.color, current.fontStyle);
                at = stop;
            }
        }
        start = end;
    }
    return result;
}
