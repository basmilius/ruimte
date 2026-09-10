/* What a row dragged out of the Files panel carries: the paths, space separated, relative to the
   folder. The composer takes it next to the image files it already accepts. */
export const MENTION_DRAG_TYPE = 'application/x-ruimte-mention';

export interface MentionQuery {
    // Index of the sigil in the text.
    start: number;
    query: string;
}

export type ChipSegment = { kind: 'text'; text: string } | { kind: 'mention'; path: string } | { kind: 'skill'; name: string };

const isBoundary = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

// A path at the end of a sentence still counts, so "open @a.ts." is a mention of a.ts.
const isTokenEnd = (char: string | undefined): boolean => isBoundary(char) || /[.,;:!?)]/.test(char!);

/*
 * The `<sigil>word` the caret sits in, if any. The sigil has to open a word (start of text or after
 * whitespace) so an email address never opens the picker, and the word may not have been
 * closed with whitespace yet.
 */
const findQuery = (text: string, caret: number, sigil: string): MentionQuery | null => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf(sigil);
    if (at < 0 || !isBoundary(before[at - 1])) {
        return null;
    }
    const query = before.slice(at + 1);
    if (/\s/.test(query) || !isBoundary(text[caret])) {
        return null;
    }
    return { start: at, query };
};

export const findMentionQuery = (text: string, caret: number): MentionQuery | null => findQuery(text, caret, '@');

/* The `$word` the caret sits in. The name has to start with a letter, so `$20` and `$1e6` stay text. */
export const findSkillQuery = (text: string, caret: number): MentionQuery | null => {
    const found = findQuery(text, caret, '$');
    return found === null || (found.query !== '' && !/^[A-Za-z]/.test(found.query)) ? null : found;
};

/* Replaces the `<sigil>query` under the caret with the chosen token and a space, and says where the caret goes. */
export const insertToken = (text: string, query: MentionQuery, sigil: string, value: string): { text: string; caret: number } => {
    const end = query.start + 1 + query.query.length;
    const token = `${sigil}${value} `;
    return { text: `${text.slice(0, query.start)}${token}${text.slice(end)}`, caret: query.start + token.length };
};

export const insertMention = (text: string, query: MentionQuery, path: string): { text: string; caret: number } => insertToken(text, query, '@', path);

export const insertSkill = (text: string, query: MentionQuery, name: string): { text: string; caret: number } => insertToken(text, query, '$', name);

const findToken = (text: string, sigil: string, value: string, from: number): number => {
    const token = `${sigil}${value}`;
    let index = text.indexOf(token, from);
    while (index >= 0) {
        if (isBoundary(text[index - 1]) && isTokenEnd(text[index + token.length])) {
            return index;
        }
        index = text.indexOf(token, index + 1);
    }
    return -1;
};

const present = (text: string, sigil: string, chosen: string[]): string[] => {
    const found: Array<{ index: number; value: string }> = [];
    for (const value of new Set(chosen)) {
        const index = findToken(text, sigil, value, 0);
        if (index >= 0) {
            found.push({ index, value });
        }
    }
    return found.sort((a, b) => a.index - b.index).map((entry) => entry.value);
};

/* The chosen mentions that still sit in the text as a whole `@path` token, in text order and without doubles. */
export const presentMentions = (text: string, chosen: string[]): string[] => present(text, '@', chosen);

/* The chosen skills that still sit in the text as a whole `$name` token, in text order and without doubles. */
export const presentSkills = (text: string, chosen: string[]): string[] => present(text, '$', chosen);

/* Splits the text so a renderer can draw the mentions and skills as chips; longer values win when one prefixes another. */
export const tokenizeChips = (text: string, mentions: string[], skills: string[] = []): ChipSegment[] => {
    const tokens = [
        ...[...new Set(mentions)].map((path) => ({ sigil: '@', value: path })),
        ...[...new Set(skills)].map((name) => ({ sigil: '$', value: name }))
    ].sort((a, b) => b.value.length - a.value.length);
    const segments: ChipSegment[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        let best: { index: number; sigil: string; value: string } | null = null;
        for (const token of tokens) {
            const index = findToken(text, token.sigil, token.value, cursor);
            if (index >= 0 && (best === null || index < best.index)) {
                best = { index, ...token };
            }
        }
        if (best === null) {
            break;
        }
        if (best.index > cursor) {
            segments.push({ kind: 'text', text: text.slice(cursor, best.index) });
        }
        segments.push(best.sigil === '@' ? { kind: 'mention', path: best.value } : { kind: 'skill', name: best.value });
        cursor = best.index + best.value.length + 1;
    }
    if (cursor < text.length) {
        segments.push({ kind: 'text', text: text.slice(cursor) });
    }
    return segments;
};
