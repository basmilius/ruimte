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

/*
 * The characters a segment stands for. A renderer draws this and nothing else, so a chip layer
 * behind a textarea spells out exactly what the textarea holds, sigil included.
 */
export const chipText = (segment: ChipSegment): string => {
    if (segment.kind === 'mention') {
        return `@${segment.path}`;
    }
    if (segment.kind === 'skill') {
        return `$${segment.name}`;
    }
    return segment.text;
};

export interface TextRange {
    from: number;
    to: number;
}

export interface ChipRange extends TextRange {
    kind: 'mention' | 'skill';
    value: string;
}

/*
 * Where the chosen mentions and skills sit in the text, in text order; longer values win when one
 * prefixes another. A token that overlaps an excluded range (a code span, say) is text.
 */
export const chipRanges = (text: string, mentions: string[], skills: string[] = [], excluded: readonly TextRange[] = []): ChipRange[] => {
    const tokens = [
        ...[...new Set(mentions)].map((value) => ({ sigil: '@', kind: 'mention' as const, value })),
        ...[...new Set(skills)].map((value) => ({ sigil: '$', kind: 'skill' as const, value }))
    ].sort((a, b) => b.value.length - a.value.length);
    const allowed = (from: number, to: number): boolean => !excluded.some((range) => from < range.to && to > range.from);
    const ranges: ChipRange[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        let best: ChipRange | null = null;
        for (const token of tokens) {
            const length = token.value.length + 1;
            let index = findToken(text, token.sigil, token.value, cursor);
            while (index >= 0 && !allowed(index, index + length)) {
                index = findToken(text, token.sigil, token.value, index + 1);
            }
            if (index >= 0 && (best === null || index < best.from)) {
                best = { from: index, to: index + length, kind: token.kind, value: token.value };
            }
        }
        if (best === null) {
            break;
        }
        ranges.push(best);
        cursor = best.to;
    }
    return ranges;
};

/* Splits the text so a renderer can draw the mentions and skills as chips. */
export const tokenizeChips = (text: string, mentions: string[], skills: string[] = []): ChipSegment[] => {
    const segments: ChipSegment[] = [];
    let cursor = 0;
    for (const range of chipRanges(text, mentions, skills)) {
        if (range.from > cursor) {
            segments.push({ kind: 'text', text: text.slice(cursor, range.from) });
        }
        segments.push(range.kind === 'mention' ? { kind: 'mention', path: range.value } : { kind: 'skill', name: range.value });
        cursor = range.to;
    }
    if (cursor < text.length) {
        segments.push({ kind: 'text', text: text.slice(cursor) });
    }
    return segments;
};
