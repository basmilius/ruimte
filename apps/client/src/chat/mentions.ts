export interface MentionQuery {
    // Index of the `@` in the text.
    start: number;
    query: string;
}

type MentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; path: string };

const isBoundary = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

// A path at the end of a sentence still counts, so "open @a.ts." is a mention of a.ts.
const isTokenEnd = (char: string | undefined): boolean => isBoundary(char) || /[.,;:!?)]/.test(char!);

/*
 * The `@word` the caret sits in, if any. The `@` has to open a word (start of text or after
 * whitespace) so an email address never opens the picker, and the word may not have been
 * closed with whitespace yet.
 */
export const findMentionQuery = (text: string, caret: number): MentionQuery | null => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0 || !isBoundary(before[at - 1])) {
        return null;
    }
    const query = before.slice(at + 1);
    if (/\s/.test(query) || !isBoundary(text[caret])) {
        return null;
    }
    return { start: at, query };
};

/* Replaces the `@query` under the caret with the chosen path and a space, and says where the caret goes. */
export const insertMention = (text: string, mention: MentionQuery, path: string): { text: string; caret: number } => {
    const end = mention.start + 1 + mention.query.length;
    const token = `@${path} `;
    return { text: `${text.slice(0, mention.start)}${token}${text.slice(end)}`, caret: mention.start + token.length };
};

/* The chosen mentions that still sit in the text as a whole `@path` token, in text order and without doubles. */
export const presentMentions = (text: string, chosen: string[]): string[] => {
    const found: Array<{ index: number; path: string }> = [];
    for (const path of new Set(chosen)) {
        const index = findToken(text, path, 0);
        if (index >= 0) {
            found.push({ index, path });
        }
    }
    return found.sort((a, b) => a.index - b.index).map((entry) => entry.path);
};

const findToken = (text: string, path: string, from: number): number => {
    const token = `@${path}`;
    let index = text.indexOf(token, from);
    while (index >= 0) {
        if (isBoundary(text[index - 1]) && isTokenEnd(text[index + token.length])) {
            return index;
        }
        index = text.indexOf(token, index + 1);
    }
    return -1;
};

/* Splits the text so a renderer can draw the mentions as chips; longer paths win when one prefixes another. */
export const tokenizeMentions = (text: string, mentions: string[]): MentionSegment[] => {
    const paths = [...new Set(mentions)].sort((a, b) => b.length - a.length);
    const segments: MentionSegment[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        let best: { index: number; path: string } | null = null;
        for (const path of paths) {
            const index = findToken(text, path, cursor);
            if (index >= 0 && (best === null || index < best.index)) {
                best = { index, path };
            }
        }
        if (best === null) {
            break;
        }
        if (best.index > cursor) {
            segments.push({ kind: 'text', text: text.slice(cursor, best.index) });
        }
        segments.push({ kind: 'mention', path: best.path });
        cursor = best.index + best.path.length + 1;
    }
    if (cursor < text.length) {
        segments.push({ kind: 'text', text: text.slice(cursor) });
    }
    return segments;
};
