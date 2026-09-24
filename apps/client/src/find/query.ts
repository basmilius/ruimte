/*
 * What a find bar asks, and the one reading of it every surface without a find of its own shares:
 * the chat's rows and a markdown preview. The editor and a page in the desktop app bring their own
 * matcher, and take the same query.
 */
export interface FindOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
}

export interface FindQuery extends FindOptions {
    text: string;
}

export const EMPTY_FIND_QUERY: FindQuery = { text: '', caseSensitive: false, wholeWord: false, regex: false };

export interface TextMatch {
    start: number;
    end: number;
}

export type CompiledFind = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'pattern'; pattern: RegExp };

/* Past this a count stops meaning anything to a reader, and marking every one would stall the page. */
export const MATCH_LIMIT = 10000;

// A letter or digit in any script, so a whole word in Dutch ends at the same place as one in English.
const WORD_CHAR = '[\\p{L}\\p{N}_]';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/* `u` in both modes, since a whole word needs Unicode classes; a pattern that only parses without it counts as invalid. */
export const compileFind = (query: FindQuery): CompiledFind => {
    if (query.text === '') {
        return { kind: 'empty' };
    }
    const body = query.regex ? query.text : escapeRegExp(query.text);
    const source = query.wholeWord ? `(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})` : body;
    // Multiline, so `^` and `$` in a pattern mean a line, the way an editor's find reads them.
    const flags = `gmu${query.caseSensitive ? '' : 'i'}`;
    try {
        return { kind: 'pattern', pattern: new RegExp(source, flags) };
    } catch {
        return { kind: 'invalid' };
    }
};

/* Every match in a text, in order. An empty match (`a*` between two letters) is nothing to show, so it is stepped over. */
export const matchesIn = (text: string, pattern: RegExp, limit: number = MATCH_LIMIT): TextMatch[] => {
    const matches: TextMatch[] = [];
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let found = global.exec(text);
    while (found !== null && matches.length < limit) {
        if (found[0] === '') {
            global.lastIndex += 1;
        } else {
            matches.push({ start: found.index, end: found.index + found[0].length });
        }
        found = global.exec(text);
    }
    return matches;
};

/* The step from one match to the next or the one before, round at either end. */
export const stepIndex = (current: number | null, count: number, direction: 1 | -1): number | null => {
    if (count === 0) {
        return null;
    }
    if (current === null) {
        return direction === 1 ? 0 : count - 1;
    }
    return (current + direction + count) % count;
};
