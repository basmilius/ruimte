import type { EditorPosition, EditorRange } from '@ruimte/smart-editor';
import type { CompletionItem, CompletionList, CompletionResult, InsertReplaceEdit, MarkupContent, TextEdit } from '@ruimte/smart-editor-lsp';
import { comparePositions } from './diagnostics-model';
import { parseSnippet, tabOrder, type SnippetStop } from './snippet';

const IDENTIFIER_CHARACTER = /[\p{L}\p{N}\p{M}_$]/u;

export function isIdentifierCharacter(character: string): boolean {
    return IDENTIFIER_CHARACTER.test(character);
}

/* The word being typed: the identifier characters at the end of the text before the caret. */
export function identifierPrefix(before: string): string {
    const characters = Array.from(before);
    let start = characters.length;
    while (start > 0 && IDENTIFIER_CHARACTER.test(characters[start - 1]!)) {
        start--;
    }
    return characters.slice(start).join('');
}

/*
 * How well a prefix fits a label, lower being better, or undefined when it does not. A match that
 * starts the label beats one that ignores case, which beats one at a camel hump or after an
 * underscore, then the initials of the humps (`gbi` for `getById`), and last the letters in order
 * for a prefix of two or more.
 */
export function matchScore(value: string, prefix: string): number | undefined {
    if (prefix === '') {
        return 0;
    }
    if (value.startsWith(prefix)) {
        return 0;
    }
    const lower = value.toLocaleLowerCase();
    const query = prefix.toLocaleLowerCase();
    if (lower.startsWith(query)) {
        return 1;
    }
    const boundaries = [...value.matchAll(/(?:^|[_$\s-])([\p{L}\p{N}])|(\p{Lu})/gu)];
    for (const boundary of boundaries) {
        const offset = boundary.index! + (boundary[1] ? boundary[0].length - boundary[1].length : 0);
        if (lower.slice(offset).startsWith(query)) {
            return 2 + offset / 1000;
        }
    }
    if (
        boundaries
            .map((match) => match[1] ?? match[2])
            .join('')
            .toLocaleLowerCase()
            .startsWith(query)
    ) {
        return 3;
    }
    if (query.length < 2 || lower[0] !== query[0]) {
        return undefined;
    }
    let cursor = 0;
    for (const character of query) {
        const next = lower.indexOf(character, cursor);
        if (next < 0) {
            return undefined;
        }
        cursor = next + character.length;
    }
    return 4 + cursor / 1000;
}

/* The range an item replaces when it is accepted; for an insert-or-replace edit, the one `replace` asks for. */
export function editRangeOf(item: CompletionItem, replace: boolean): EditorRange | null {
    const edit = item.textEdit;
    if (edit === undefined) {
        return null;
    }
    if ('range' in edit) {
        return edit.range;
    }
    return replace ? edit.replace : edit.insert;
}

/* Items from a result, with the list's defaults filled in so each carries its own edit range and format. */
export function itemsOf(result: CompletionResult): { items: CompletionItem[]; incomplete: boolean } {
    if (result === null) {
        return { items: [], incomplete: false };
    }
    if (Array.isArray(result)) {
        return { items: result, incomplete: false };
    }
    const list: CompletionList = result;
    const defaults = list.itemDefaults;
    if (defaults === undefined) {
        return { items: list.items, incomplete: list.isIncomplete };
    }
    return {
        incomplete: list.isIncomplete,
        items: list.items.map((item) => {
            const next: CompletionItem = { ...item };
            if (defaults.insertTextFormat !== undefined && next.insertTextFormat === undefined) {
                next.insertTextFormat = defaults.insertTextFormat;
            }
            if (next.textEdit === undefined && defaults.editRange !== undefined) {
                const text = item.textEditText ?? item.insertText ?? item.label;
                next.textEdit =
                    'start' in defaults.editRange
                        ? { range: defaults.editRange, newText: text }
                        : { insert: defaults.editRange.insert, replace: defaults.editRange.replace, newText: text };
            }
            return next;
        })
    };
}

/*
 * What a person has typed of an item: from the start of the range it will replace up to the caret when
 * the caret is in that range, else the word before the caret. Matching against that is what keeps
 * `thisArg.` from filtering on the dot.
 */
export function prefixFor(item: CompletionItem, caret: EditorPosition, lineBefore: string, textBetween: (range: EditorRange) => string): string {
    const range = editRangeOf(item, false);
    if (range !== null && range.start.line === caret.line && comparePositions(range.start, caret) <= 0 && comparePositions(caret, range.end) <= 0) {
        return textBetween({ start: range.start, end: caret });
    }
    return identifierPrefix(lineBefore);
}

export interface Ranked {
    readonly item: CompletionItem;
    readonly score: number;
}

/* The items that fit what is typed, best first: by how they match, a preselected one before the rest, then the server's own order. */
export function rankCompletions(items: readonly CompletionItem[], prefixOf: (item: CompletionItem) => string, limit = 150): Ranked[] {
    return items
        .map((item, index) => ({ item, index, score: matchScore(item.filterText ?? item.label, prefixOf(item)) }))
        .filter((entry): entry is { item: CompletionItem; index: number; score: number } => entry.score !== undefined)
        .sort(
            (left, right) =>
                left.score - right.score ||
                Number(right.item.preselect === true) - Number(left.item.preselect === true) ||
                (left.item.sortText ?? left.item.label).localeCompare(right.item.sortText ?? right.item.label) ||
                left.index - right.index
        )
        .slice(0, limit)
        .map(({ item, score }) => ({ item, score }));
}

/* A snippet as the plain text it would insert: tab stops and variables vanish, placeholders and choices become their text, and the escapes of the format are undone. */
export function snippetToText(snippet: string): string {
    return parseSnippet(snippet).text;
}

const METHOD_KIND = 2;
const FUNCTION_KIND = 3;
const CONSTRUCTOR_KIND = 4;
const SNIPPET_FORMAT = 2;

/* A call snippet with the call cut off, for a name that already has its parentheses: `log(${1:value})$0` becomes `log`. */
function withoutCall(snippet: string): string {
    const open = snippet.search(/(?<!\\)\(/);
    return open > 0 ? snippet.slice(0, open) : snippet;
}

export interface Insertion {
    readonly range: EditorRange;
    readonly text: string;
    /* Where Tab goes in the inserted text, in order; empty for plain text and for a snippet without stops. */
    readonly stops: readonly SnippetStop[];
}

/*
 * What goes into the text for an item and the range it takes the place of, given the caret. `lineAfter` is
 * the rest of the line after the caret: an item that would add a call does not when a parenthesis follows.
 */
export function insertionOf(item: CompletionItem, caret: EditorPosition, lineBefore: string, replace: boolean, lineAfter = ''): Insertion {
    const raw = item.textEdit?.newText ?? item.insertText ?? item.label;
    const edit = editRangeOf(item, replace);
    const range =
        edit === null
            ? { start: { line: caret.line, character: caret.character - identifierPrefix(lineBefore).length }, end: caret }
            : // The word grew since the answer came, so what was typed since belongs to what is replaced.
              { start: edit.start, end: comparePositions(edit.end, caret) < 0 && edit.end.line === caret.line ? caret : edit.end };
    if (item.insertTextFormat !== SNIPPET_FORMAT) {
        return { range, text: raw, stops: [] };
    }
    const followed = range.end.line === caret.line && lineAfter.slice(Math.max(0, range.end.character - caret.character)).startsWith('(');
    const callable = item.kind === METHOD_KIND || item.kind === FUNCTION_KIND || item.kind === CONSTRUCTOR_KIND;
    const parsed = parseSnippet(followed && callable ? withoutCall(raw) : raw);
    return { range, text: parsed.text, stops: tabOrder(parsed) };
}

export function documentationText(documentation: string | MarkupContent | undefined): string {
    if (documentation === undefined) {
        return '';
    }
    return typeof documentation === 'string'
        ? documentation
        : documentation.kind === 'plaintext'
          ? documentation.value.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1')
          : documentation.value;
}

export type { InsertReplaceEdit, TextEdit };

const KIND_LETTERS: Record<number, string> = {
    1: 't',
    2: 'm',
    3: 'f',
    4: 'c',
    5: 'p',
    6: 'v',
    7: 'c',
    8: 'i',
    9: 'm',
    10: 'p',
    11: 'u',
    12: 'v',
    13: 'e',
    14: 'k',
    15: 's',
    16: 'c',
    17: 'f',
    18: 'r',
    19: 'f',
    20: 'e',
    21: 'k',
    22: 's',
    23: 'e',
    24: 'o',
    25: 't'
};

export type KindTone = 'callable' | 'value' | 'type' | 'other';

const KIND_TONES: Record<number, KindTone> = {
    2: 'callable',
    3: 'callable',
    4: 'callable',
    5: 'value',
    6: 'value',
    10: 'value',
    12: 'value',
    20: 'value',
    21: 'value',
    7: 'type',
    8: 'type',
    9: 'type',
    13: 'type',
    22: 'type',
    25: 'type'
};

export function kindLetterOf(kind: number | undefined): string {
    return kind === undefined ? '·' : (KIND_LETTERS[kind] ?? '·');
}

export function kindToneOf(kind: number | undefined): KindTone {
    return kind === undefined ? 'other' : (KIND_TONES[kind] ?? 'other');
}
