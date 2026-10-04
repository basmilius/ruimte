// Copyright 2000-2023 JetBrains s.r.o. and contributors.
// Adapted to TypeScript under Apache-2.0; see NOTICE, README.md and LICENSE.apache-2.0.txt.
//
// isWordBoundary, isHumpBoundary and isPunctuation adapt `isWordBoundary`, `isHumpBound`,
// `isLowerCaseOrDigit` and `isPunctuation` from JetBrains/intellij-community at
// 7184b03af6c5370e79a01ded0df68cf56d7669da, platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java,
// lines 934-982.

// Java's Character.isJavaIdentifierPart, which counts the ignorable control characters as part of a word.
// oxlint-disable-next-line no-control-regex
const identifierPart = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mc}\p{Mn}\p{Cf}\u0000-\u0008\u000e-\u001b\u007f-\u009f]/u;
// Java's Character.isWhitespace: no no-break spaces.
// oxlint-disable-next-line no-control-regex
const whitespace = /[\t\n\v\f\r\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]/u;
const lower = /\p{Lowercase}/u;
const upper = /\p{Uppercase}/u;
const digit = /\p{Nd}/u;
const letterOrDigit = /[\p{L}\p{Nd}]/u;

/** A string, or anything that reads like one, such as the rope. */
export type WordText = string | { readonly length: number; charAt(offset: number): string };

function characterAt(text: WordText, offset: number): string {
    return offset >= 0 && offset < text.length ? text.charAt(offset) : '\0';
}

function isPunctuation(character: string): boolean {
    return !(identifierPart.test(character) || whitespace.test(character));
}

/** Whether `offset` splits a camel hump, a digit run or an underscore from the word around it. */
export function isHumpBoundary(text: WordText, offset: number, isStart: boolean): boolean {
    if (offset <= 0 || offset >= text.length) {
        return false;
    }
    const previous = characterAt(text, offset - 1);
    const current = characterAt(text, offset);
    const next = characterAt(text, offset + 1);
    const hump = isStart ? current : previous;
    const neighbor = isStart ? previous : current;
    return (
        ((lower.test(previous) || digit.test(previous)) && upper.test(current)) ||
        (neighbor === '_' && hump !== '_') ||
        (neighbor === '$' && letterOrDigit.test(hump)) ||
        (upper.test(previous) && upper.test(current) && lower.test(next))
    );
}

/** Whether a word starts (`isStart`) or ends at `offset`. Punctuation runs count as words. */
export function isWordBoundary(text: WordText, offset: number, camel: boolean, isStart: boolean): boolean {
    if (offset < 0 || offset > text.length) {
        return false;
    }
    const previous = characterAt(text, offset - 1);
    const current = characterAt(text, offset);
    const word = isStart ? current : previous;
    const neighbor = isStart ? previous : current;
    if (identifierPart.test(word)) {
        if (!identifierPart.test(neighbor)) {
            return true;
        }
        if (camel && isHumpBoundary(text, offset, isStart)) {
            return true;
        }
    }
    return isPunctuation(word) && !isPunctuation(neighbor);
}

/** The next stop in `direction`, never inside a surrogate pair or between CR and LF. Written here, not ported. */
export function wordBoundary(text: WordText, offset: number, direction: -1 | 1, camel = true): number {
    let position = offset + direction;
    while (position > 0 && position < text.length) {
        const before = text.charAt(position - 1);
        const after = text.charAt(position);
        const splitsPair = /[\ud800-\udbff]/.test(before) && /[\udc00-\udfff]/.test(after);
        const splitsLineBreak = before === '\r' && after === '\n';
        if (!splitsPair && !splitsLineBreak && isWordBoundary(text, position, camel, direction === -1)) {
            return position;
        }
        position += direction;
    }
    return Math.max(0, Math.min(text.length, position));
}
