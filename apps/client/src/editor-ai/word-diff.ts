import { diffLines } from '@adecore/merge';

/* A word, a run of spaces or one other character, so a change inside a line is found by word and not by letter. */
const TOKEN = /\w+|\s+|[^\w\s]/g;

/*
 * The character ranges of each removed line that the added lines changed, `[start, end)` per line, for
 * the stronger tint on the words a change replaced. Lines are only compared when as many were added as
 * removed, since then each removed line has the line it became; any other change has no such pairing
 * and draws no words.
 */
export function replacedWords(removed: readonly string[], added: readonly string[]): Array<Array<[number, number]>> {
    return removed.map((line, index) => (removed.length === added.length ? replacedRanges(line, added[index]!) : []));
}

function replacedRanges(removed: string, added: string): Array<[number, number]> {
    const before = removed.match(TOKEN) ?? [];
    const after = added.match(TOKEN) ?? [];
    const starts: number[] = [];
    let offset = 0;
    for (const token of before) {
        starts.push(offset);
        offset += token.length;
    }
    starts.push(offset);
    const ranges: Array<[number, number]> = [];
    for (const change of diffLines(before, after)) {
        const text = removed.slice(starts[change.baseStart]!, starts[change.baseEnd]!);
        if (text.trim() !== '') {
            const start = starts[change.baseStart]! + (text.length - text.trimStart().length);
            ranges.push([start, start + text.trim().length]);
        }
    }
    return ranges;
}
