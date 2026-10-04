export interface FindOptions {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    /** Bounds filter matches of the whole document, so anchors and lookarounds still see their context. */
    from?: number;
    to?: number;
    maxResults?: number;
}

export interface FindNextOptions extends FindOptions {
    backwards?: boolean;
    /** On unless `false`. */
    wrap?: boolean;
}

/** Only valid for the revision it was found in; `replace` refuses a stale one. */
export interface FindMatch {
    from: number;
    to: number;
    text: string;
    captures: readonly (string | undefined)[];
    groups?: Readonly<Record<string, string | undefined>>;
    regex: boolean;
    revision: number;
}

const wordCharacter = /[\p{L}\p{N}\p{M}\p{Pc}$]/u;

/** Whether `offset` sits between the two halves of a surrogate pair. */
export function splitsSurrogate(text: { charAt(offset: number): string }, offset: number): boolean {
    return /[\ud800-\udbff]/.test(text.charAt(offset - 1)) && /[\udc00-\udfff]/.test(text.charAt(offset));
}

function characterBefore(text: string, offset: number): string {
    return text.slice(offset - (splitsSurrogate(text, offset - 1) ? 2 : 1), offset);
}

/** Invalid bounds throw `RangeError`, an invalid expression `SyntaxError`. A zero-width match advances by one code point. */
export function findMatches(text: string, query: string, revision: number, options: FindOptions = {}): FindMatch[] {
    if (!query && !options.regex) {
        return [];
    }
    const from = options.from ?? 0;
    const to = options.to ?? text.length;
    const maximum = options.maxResults ?? Infinity;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length) {
        throw new RangeError('Search bounds must be ordered offsets inside the document.');
    }
    if (maximum !== Infinity && (!Number.isInteger(maximum) || maximum < 0)) {
        throw new RangeError('maxResults must be a nonnegative integer.');
    }
    const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(source, `gmu${options.caseSensitive ? '' : 'i'}`);
    expression.lastIndex = from;
    const matches: FindMatch[] = [];
    while (matches.length < maximum) {
        const match = expression.exec(text);
        if (!match || match.index > to) {
            break;
        }
        const end = match.index + match[0].length;
        const wholeWord =
            !options.wholeWord ||
            (!wordCharacter.test(characterBefore(text, match.index)) && !wordCharacter.test(String.fromCodePoint(text.codePointAt(end) ?? 0)));
        if (match.index >= from && end <= to && !splitsSurrogate(text, match.index) && !splitsSurrogate(text, end) && wholeWord) {
            matches.push({
                from: match.index,
                to: end,
                text: match[0],
                captures: match.slice(1),
                groups: match.groups ? { ...match.groups } : undefined,
                regex: options.regex === true,
                revision
            });
        }
        if (!match[0].length) {
            expression.lastIndex = match.index + ((text.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1);
        }
    }
    return matches;
}

/** Expands the JavaScript `$` patterns of a regex replacement. Literal replacements are returned as they are. */
export function replacementText(text: string, match: FindMatch, replacement: string, literal = false): string {
    if (literal || !match.regex) {
        return replacement;
    }
    return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token: string, group: string) => {
        if (group === '$') {
            return '$';
        }
        if (group === '&') {
            return match.text;
        }
        if (group === '`') {
            return text.slice(0, match.from);
        }
        if (group === "'") {
            return text.slice(match.to);
        }
        if (group.startsWith('<')) {
            return match.groups ? (match.groups[group.slice(1, -1)] ?? '') : token;
        }
        const index = Number(group);
        if (index > 0 && index <= match.captures.length) {
            return match.captures[index - 1] ?? '';
        }
        const first = Number(group[0]);
        if (group.length === 2 && first > 0 && first <= match.captures.length) {
            return (match.captures[first - 1] ?? '') + group[1];
        }
        return token;
    });
}
