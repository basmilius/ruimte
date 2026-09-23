export interface TextSpan {
    /* UTF-16 offsets into the text before the change. */
    readonly start: number;
    readonly end: number;
    /* What stands between them after it. */
    readonly text: string;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/*
 * The one stretch that differs between two texts, found from both ends. Replacing only that keeps a
 * cursor, a selection and the scroll where they were anywhere outside it, which setting the whole
 * text would not. Null when the two are the same.
 */
export const changedSpan = (before: string, after: string): TextSpan | null => {
    if (before === after) {
        return null;
    }
    const limit = Math.min(before.length, after.length);
    let start = 0;
    while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) {
        start += 1;
    }
    // Never between the halves of a surrogate pair, which would leave a lone half on either side.
    if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) {
        start -= 1;
    }
    let tail = 0;
    while (tail < limit - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) {
        tail += 1;
    }
    if (tail > 0 && isLowSurrogate(before.charCodeAt(before.length - tail))) {
        tail -= 1;
    }
    return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
};
