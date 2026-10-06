import type { DocumentSymbol, DocumentSymbolResult, SymbolInformation, WorkspaceSymbol, WorkspaceSymbolResult } from '@adecore/lsp';
import type { EditorRange } from '@adecore/editor';

export type SymbolGroup = 'namespaces' | 'classes' | 'interfaces' | 'enums' | 'functions' | 'methods' | 'properties' | 'variables' | 'constants' | 'other';

/* The order the groups are listed in: what a file declares, then what those declare. */
export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
    'namespaces',
    'classes',
    'interfaces',
    'enums',
    'functions',
    'methods',
    'properties',
    'variables',
    'constants',
    'other'
];

const GROUP_OF_KIND: Record<number, SymbolGroup> = {
    2: 'namespaces',
    3: 'namespaces',
    4: 'namespaces',
    5: 'classes',
    23: 'classes',
    11: 'interfaces',
    10: 'enums',
    22: 'enums',
    12: 'functions',
    6: 'methods',
    9: 'methods',
    7: 'properties',
    8: 'properties',
    13: 'variables',
    14: 'constants',
    26: 'other'
};

export function groupOfKind(kind: number): SymbolGroup {
    return GROUP_OF_KIND[kind] ?? 'other';
}

const LETTERS: Record<SymbolGroup, string> = {
    namespaces: 'N',
    classes: 'C',
    interfaces: 'I',
    enums: 'E',
    functions: 'f',
    methods: 'm',
    properties: 'p',
    variables: 'v',
    constants: 'c',
    other: '·'
};

/* The letter in the badge in front of a symbol. */
export function letterOfKind(kind: number): string {
    return kind === 22 ? 'e' : LETTERS[groupOfKind(kind)];
}

export type SymbolTone = 'callable' | 'value' | 'type' | 'other';

export function toneOfKind(kind: number): SymbolTone {
    const group = groupOfKind(kind);
    return group === 'functions' || group === 'methods'
        ? 'callable'
        : group === 'classes' || group === 'interfaces' || group === 'enums'
          ? 'type'
          : group === 'properties' || group === 'variables' || group === 'constants'
            ? 'value'
            : 'other';
}

/* One symbol of a file as a row of the picker. */
export interface SymbolEntry {
    readonly id: string;
    readonly name: string;
    readonly kind: number;
    /* The symbols it sits in, outermost first, joined by dots. */
    readonly container: string;
    /* What the server says after the name, such as the parameters. */
    readonly detail: string;
    /* Zero-based, where the name is. */
    readonly line: number;
    readonly character: number;
}

function isHierarchical(symbols: readonly (DocumentSymbol | SymbolInformation)[]): symbols is DocumentSymbol[] {
    return symbols.length > 0 && 'selectionRange' in symbols[0]!;
}

/* The symbols of a file, parents before their children, in the order of the file. */
export function entriesOf(result: DocumentSymbolResult): SymbolEntry[] {
    const entries: SymbolEntry[] = [];
    const add = (name: string, kind: number, container: string, detail: string, at: EditorRange['start']): void => {
        entries.push({ id: String(entries.length), name, kind, container, detail, line: at.line, character: at.character });
    };
    const walk = (symbols: readonly DocumentSymbol[], container: string): void => {
        for (const symbol of symbols) {
            add(symbol.name, symbol.kind, container, symbol.detail ?? '', symbol.selectionRange.start);
            walk(symbol.children ?? [], container === '' ? symbol.name : `${container}.${symbol.name}`);
        }
    };
    if (result === null || result.length === 0) {
        return entries;
    }
    if (isHierarchical(result)) {
        walk(result, '');
    } else {
        for (const symbol of result as SymbolInformation[]) {
            add(symbol.name, symbol.kind, symbol.containerName ?? '', '', symbol.location.range.start);
        }
    }
    return entries;
}

/* How well a query matches a name: 3 for a prefix, 2 for a part of it, 1 for its letters in order, 0 for no match. Case is ignored. */
export function scoreOf(name: string, query: string): number {
    const haystack = name.toLowerCase();
    const needle = query.toLowerCase();
    if (needle === '') {
        return 1;
    }
    if (haystack.startsWith(needle)) {
        return 3;
    }
    if (haystack.includes(needle)) {
        return 2;
    }
    let from = 0;
    for (const character of needle) {
        from = haystack.indexOf(character, from) + 1;
        if (from === 0) {
            return 0;
        }
    }
    return 1;
}

/* The entries that match, best first within each group; without a query, in the order of the file. */
export function filterEntries(entries: readonly SymbolEntry[], query: string): SymbolEntry[] {
    const trimmed = query.trim();
    const scored = entries.map((entry, index) => ({ entry, index, score: scoreOf(entry.name, trimmed) })).filter((candidate) => candidate.score > 0);
    return scored
        .sort((left, right) => (trimmed === '' ? left.index - right.index : right.score - left.score || left.index - right.index))
        .map((candidate) => candidate.entry);
}

export interface EntryGroup {
    readonly group: SymbolGroup;
    readonly entries: readonly SymbolEntry[];
}

/* The entries in their groups, in the order of the groups, and so in the order the list is walked with the arrows. */
export function groupEntries(entries: readonly SymbolEntry[]): EntryGroup[] {
    return SYMBOL_GROUPS.flatMap((group) => {
        const own = entries.filter((entry) => groupOfKind(entry.kind) === group);
        return own.length === 0 ? [] : [{ group, entries: own }];
    });
}

export type PickerMode =
    | { readonly mode: 'symbol'; readonly text: string }
    | { readonly mode: 'workspace'; readonly text: string }
    | { readonly mode: 'line'; readonly line: number | null };

/* `#name` searches the whole project, `:12` goes to a line, anything else filters the symbols of the file. */
export function modeOf(input: string): PickerMode {
    if (input.startsWith('#')) {
        return { mode: 'workspace', text: input.slice(1).trim() };
    }
    if (input.startsWith(':')) {
        const line = Number.parseInt(input.slice(1), 10);
        return { mode: 'line', line: Number.isFinite(line) && line > 0 ? line : null };
    }
    return { mode: 'symbol', text: input };
}

/* A symbol of the project as a place to go to. */
export interface WorkspaceEntry {
    readonly id: string;
    readonly name: string;
    readonly kind: number;
    readonly container: string;
    readonly uri: string;
    readonly line: number;
}

export function workspaceEntriesOf(result: WorkspaceSymbolResult): WorkspaceEntry[] {
    return ((result ?? []) as (SymbolInformation | WorkspaceSymbol)[]).map((symbol, index) => ({
        id: String(index),
        name: symbol.name,
        kind: symbol.kind,
        container: symbol.containerName ?? '',
        uri: symbol.location.uri,
        line: 'range' in symbol.location ? symbol.location.range.start.line : 0
    }));
}
