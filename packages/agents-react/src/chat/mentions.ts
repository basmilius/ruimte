/* What a file dragged out of an app's own list of files carries: the paths, space separated, relative
   to the folder. The composer takes it next to the image files it already accepts. */
export const MENTION_DRAG_TYPE = 'application/x-ruimte-mention';

export interface MentionQuery {
    // Index of the sigil in the text.
    start: number;
    query: string;
}

export type ChipSegment = { kind: 'text'; text: string } | { kind: 'mention'; path: string } | { kind: 'skill'; name: string };

function isBoundary(char: string | undefined): boolean {
    return char === undefined || /\s/.test(char);
}

// A path at the end of a sentence still counts, so "open @a.ts." is a mention of a.ts.
function isTokenEnd(char: string | undefined): boolean {
    return isBoundary(char) || /[.,;:!?)]/.test(char!);
}

/*
 * The `<sigil>word` the caret sits in, if any. The sigil has to open a word (start of text or after
 * whitespace) so an email address never opens the picker, and the word may not have been
 * closed with whitespace yet.
 */
function findQuery(text: string, caret: number, sigil: string): MentionQuery | null {
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
}

export function findMentionQuery(text: string, caret: number): MentionQuery | null {
    return findQuery(text, caret, '@');
}

/* The `$word` the caret sits in. The name has to start with a letter, so `$20` and `$1e6` stay text. */
export function findSkillQuery(text: string, caret: number): MentionQuery | null {
    const found = findQuery(text, caret, '$');
    return found === null || (found.query !== '' && !/^[A-Za-z]/.test(found.query)) ? null : found;
}

/* Replaces the `<sigil>query` under the caret with the chosen token and a space, and says where the caret goes. */
export function insertToken(text: string, query: MentionQuery, sigil: string, value: string): { text: string; caret: number } {
    const end = query.start + 1 + query.query.length;
    const token = `${sigil}${value} `;
    return { text: `${text.slice(0, query.start)}${token}${text.slice(end)}`, caret: query.start + token.length };
}

/* Takes the `<sigil>query` under the caret out, for a pick that lands beside the text instead of in it. */
export function dropQuery(text: string, query: MentionQuery): { text: string; caret: number } {
    return {
        text: `${text.slice(0, query.start)}${text.slice(query.start + 1 + query.query.length)}`,
        caret: query.start
    };
}

export function insertMention(text: string, query: MentionQuery, path: string): { text: string; caret: number } {
    return insertToken(text, query, '@', path);
}

export function insertSkill(text: string, query: MentionQuery, name: string): { text: string; caret: number } {
    return insertToken(text, query, '$', name);
}

/* What a file search answered, with the query it answered, since the query moves on while the answer is on its way. */
export interface MentionSearch {
    query: string | null;
    files: string[];
}

export const NO_MENTION_SEARCH: MentionSearch = { query: null, files: [] };

export type MentionPick<T> = { kind: 'chat'; chat: T } | { kind: 'file'; path: string };

/* What Enter or Tab takes from the `@` list at `index`. Files still on screen from an older query are never taken. */
export function mentionPick<T>(index: number, chats: readonly T[], search: MentionSearch, query: string): MentionPick<T> | null {
    const chat = chats[index];
    if (chat !== undefined) {
        return { kind: 'chat', chat };
    }
    if (search.query !== query) {
        return null;
    }
    const path = search.files[index - chats.length] ?? search.files[0];
    return path === undefined ? null : { kind: 'file', path };
}

function findToken(text: string, sigil: string, value: string, from: number): number {
    const token = `${sigil}${value}`;
    let index = text.indexOf(token, from);
    while (index >= 0) {
        if (isBoundary(text[index - 1]) && isTokenEnd(text[index + token.length])) {
            return index;
        }
        index = text.indexOf(token, index + 1);
    }
    return -1;
}

function present(text: string, sigil: string, chosen: string[]): string[] {
    const found: Array<{ index: number; value: string }> = [];
    for (const value of new Set(chosen)) {
        const index = findToken(text, sigil, value, 0);
        if (index >= 0) {
            found.push({ index, value });
        }
    }
    return found.sort((a, b) => a.index - b.index).map((entry) => entry.value);
}

/* The chosen mentions that still sit in the text as a whole `@path` token, in text order and without doubles. */
export function presentMentions(text: string, chosen: string[]): string[] {
    return present(text, '@', chosen);
}

/* The chosen skills that still sit in the text as a whole `$name` token, in text order and without doubles. */
export function presentSkills(text: string, chosen: string[]): string[] {
    return present(text, '$', chosen);
}

/*
 * The characters a segment stands for, sigil included. Joined, the segments spell the text they
 * were cut from.
 */
export function chipText(segment: ChipSegment): string {
    if (segment.kind === 'mention') {
        return `@${segment.path}`;
    }
    if (segment.kind === 'skill') {
        return `$${segment.name}`;
    }
    return segment.text;
}

/*
 * The paths in a pasted text that is nothing but `@path` tokens, which is what copying mentions from
 * a list of files puts on the clipboard. Any other text, an email address included, is text.
 */
export function pastedMentions(text: string): string[] {
    const tokens = text.trim().split(/\s+/);
    if (tokens.some((token) => !/^@[^\s@]+$/.test(token))) {
        return [];
    }
    return [...new Set(tokens.map((token) => token.slice(1)))];
}

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
export function chipRanges(text: string, mentions: string[], skills: string[] = [], excluded: readonly TextRange[] = []): ChipRange[] {
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
}

/* Splits the text so a renderer can draw the mentions and skills as chips. */
export function tokenizeChips(text: string, mentions: string[], skills: string[] = []): ChipSegment[] {
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
}
