import type { DocumentSymbol, DocumentSymbolResult, Position, SymbolInformation } from '@ruimte/smart-editor-lsp';
import { formatNumber } from '@basmilius/desktop-ui/format';
import i18next from 'i18next';

/* More declarations than this in one file and the rows are left out, which is the file that is too big for them to be quiet. */
export const MAX_DECLARATIONS = 3000;

/* LSP's SymbolKind: the kinds a row is drawn for and the ones whose children can be declarations too. */
const CLASS = 5;
const METHOD = 6;
const PROPERTY = 7;
const FIELD = 8;
const CONSTRUCTOR = 9;
const ENUM = 10;
const INTERFACE = 11;
const FUNCTION = 12;
const CONSTANT = 14;
const STRUCT = 23;
const CONTAINERS: ReadonlySet<number> = new Set([1, 2, 3, 4, CLASS, ENUM, INTERFACE, STRUCT]);
const TYPES: ReadonlySet<number> = new Set([CLASS, ENUM, INTERFACE, STRUCT]);
const CALLABLES: ReadonlySet<number> = new Set([METHOD, FUNCTION]);

export interface CodeVisionDeclaration {
    /* The same declaration keeps its id through edits, so what a row showed stays until the new answer is in. */
    readonly id: string;
    readonly name: string;
    /* Where the name starts, which is where the references are asked. */
    readonly position: Position;
    /* The line the row sits above: where the declaration starts once the comments before it are passed. */
    readonly line: number;
    readonly usages: boolean;
    readonly authors: boolean;
    /* The lines whose authors count: from the name to the last line that holds more than closing brackets. */
    readonly authorFrom: number;
    readonly authorTo: number;
}

export interface DeclarationSource {
    readonly lineCount: number;
    lineAt(line: number): string;
    readonly languageId: string;
}

/* Languages whose `#` starts a comment, so a docblock written with it is passed like any other. */
const HASH_COMMENTS: ReadonlySet<string> = new Set(['php', 'python', 'shellscript', 'ruby', 'yaml', 'dockerfile']);

interface Candidate {
    readonly name: string;
    readonly kind: number;
    readonly start: Position;
    readonly end: Position;
    readonly namePosition: Position | null;
    readonly path: readonly string[];
    readonly parentKind: number | null;
}

function isLocalName(name: string): boolean {
    return name === '' || name.startsWith('<') || name === 'default';
}

function isUsageKind(kind: number, parentKind: number | null): boolean {
    if (TYPES.has(kind) || CALLABLES.has(kind)) {
        return true;
    }
    return (kind === PROPERTY || kind === FIELD || kind === CONSTANT) && (parentKind === CLASS || parentKind === STRUCT);
}

function isAuthorKind(kind: number): boolean {
    return TYPES.has(kind) || CALLABLES.has(kind) || kind === CONSTRUCTOR;
}

function walk(symbols: readonly DocumentSymbol[], path: readonly string[], parentKind: number | null, out: Candidate[]): void {
    for (const symbol of symbols) {
        out.push({
            name: symbol.name,
            kind: symbol.kind,
            start: symbol.range.start,
            end: symbol.range.end,
            namePosition: symbol.selectionRange.start,
            path,
            parentKind
        });
        // What a function or a method holds is local to it, and a row for a callback is noise.
        if (CONTAINERS.has(symbol.kind)) {
            walk(symbol.children ?? [], [...path, symbol.name], symbol.kind, out);
        }
    }
}

function candidatesOf(result: DocumentSymbolResult): Candidate[] {
    const out: Candidate[] = [];
    if (result === null || result.length === 0) {
        return out;
    }
    if ('range' in result[0]!) {
        walk(result as DocumentSymbol[], [], null, out);
        return out;
    }
    const flat = result as SymbolInformation[];
    const containers = new Map(flat.filter((symbol) => CONTAINERS.has(symbol.kind)).map((symbol) => [symbol.name, symbol.kind]));
    for (const symbol of flat) {
        const container = symbol.containerName ?? '';
        if (container !== '' && !containers.has(container)) {
            continue;
        }
        out.push({
            name: symbol.name,
            kind: symbol.kind,
            start: symbol.location.range.start,
            end: symbol.location.range.end,
            namePosition: null,
            path: container === '' ? [] : [container],
            parentKind: container === '' ? null : (containers.get(container) ?? null)
        });
    }
    return out;
}

/*
 * Where a declaration really starts: past the comments and the blank lines a server counts into its
 * range. Null when its range is nothing but comments.
 */
export function startAfterComments(source: DeclarationSource, from: Position, to: Position): Position | null {
    const hash = HASH_COMMENTS.has(source.languageId);
    let line = from.line;
    let character = from.character;
    while (line <= to.line && line < source.lineCount) {
        const text = source.lineAt(line);
        let at = character;
        while (at < text.length && (text[at] === ' ' || text[at] === '\t')) {
            at++;
        }
        if (at >= text.length) {
            line++;
            character = 0;
            continue;
        }
        if (text.startsWith('/*', at)) {
            let end = text.indexOf('*/', at + 2);
            let scan = line;
            while (end === -1 && scan + 1 <= to.line && scan + 1 < source.lineCount) {
                scan++;
                end = source.lineAt(scan).indexOf('*/');
            }
            if (end === -1) {
                return null;
            }
            line = scan;
            character = end + 2;
            continue;
        }
        if (text.startsWith('//', at) || (hash && text[at] === '#' && text[at + 1] !== '[')) {
            line++;
            character = 0;
            continue;
        }
        return line > to.line ? null : { line, character: at };
    }
    return null;
}

const CLOSERS = /^\s*[})\]]*[;,]?\s*$/;

/* The last line of a declaration that holds more than the brackets that close it or nothing, which is what its authors are read from. */
function lastLineWithCode(source: DeclarationSource, from: number, to: number): number {
    for (let line = Math.min(to, source.lineCount - 1); line > from; line--) {
        if (!CLOSERS.test(source.lineAt(line))) {
            return line;
        }
    }
    return from;
}

/* Where the name starts when a server gave only a range: its first occurrence on the line the declaration starts on. */
function nameIn(source: DeclarationSource, name: string, start: Position): Position | null {
    const at = source.lineAt(start.line).indexOf(name, start.character);
    return at === -1 ? null : { line: start.line, character: at };
}

/*
 * The declarations of a file a row is drawn above: classes, interfaces, enums, structs, functions and
 * methods, and the properties and constants of a class, wherever they stand outside the body of a
 * function. Only one that starts its line gets a row, since a row sits above the line.
 */
export function declarationsOf(result: DocumentSymbolResult, source: DeclarationSource): CodeVisionDeclaration[] {
    const declarations: CodeVisionDeclaration[] = [];
    const seen = new Map<string, number>();
    for (const candidate of candidatesOf(result)) {
        if (isLocalName(candidate.name)) {
            continue;
        }
        const usages = isUsageKind(candidate.kind, candidate.parentKind) && !candidate.name.startsWith('__');
        const authors = isAuthorKind(candidate.kind);
        if (!usages && !authors) {
            continue;
        }
        const start = startAfterComments(source, candidate.start, candidate.end);
        if (start === null || source.lineAt(start.line).slice(0, start.character).trim() !== '') {
            continue;
        }
        const position = candidate.namePosition ?? nameIn(source, candidate.name, start);
        if (position === null) {
            continue;
        }
        const key = `${candidate.path.join('>')}>${candidate.name}#${candidate.kind}`;
        const index = seen.get(key) ?? 0;
        seen.set(key, index + 1);
        declarations.push({
            id: `${key}#${index}`,
            name: candidate.name,
            position,
            line: start.line,
            usages,
            authors,
            authorFrom: position.line,
            authorTo: lastLineWithCode(source, position.line, candidate.end.line)
        });
        if (declarations.length > MAX_DECLARATIONS) {
            return [];
        }
    }
    return declarations;
}

/* "No usages", "1 usage" and "N usages". */
export function usagesText(count: number): string {
    return count === 0
        ? i18next.t('panels:language.codeVision.usagesNone')
        : i18next.t('panels:language.codeVision.usages', { count, formatted: formatNumber(count) });
}
