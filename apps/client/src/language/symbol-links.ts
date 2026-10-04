import type { Location, SymbolInformation, WorkspaceSymbol, WorkspaceSymbolResult } from '@ruimte/smart-editor-lsp';

/* The classes a name in a signature has: a pointer and an underline on hover, and the accent only then, so the signature stays calm. */
export const SYMBOL_LINK_CLASS = 'cursor-pointer hover:text-accent hover:underline';

/* A name that reads as a type: it starts with a capital and has a lowercase letter, which leaves `DEFAULT_WEIGHTS` and `T` alone. */
const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;

export function isTypeName(name: string): boolean {
    return TYPE_NAME.test(name) && /[a-z]/.test(name);
}

/*
 * Marks the type-like names of a highlighted snippet as links. Shiki writes each token as a span of its own,
 * so a name that is the whole text of a token is one; a string or a comment is never that.
 */
export function linkTypeNames(html: string): string {
    return html.replace(/>([A-Z][A-Za-z0-9_]*)</g, (match, name: string) =>
        isTypeName(name) ? `><span data-symbol="${name}" class="${SYMBOL_LINK_CLASS}">${name}</span><` : match
    );
}

const DECLARES = /\b(?:class|interface|enum|trait|type|namespace|struct|function|const|let|var)\s+&?([A-Za-z_$][\w$]*)/;

/* The name a signature declares, such as `IssueTicketsMessage` in `final class IssueTicketsMessage implements MessageInterface`; null for one that declares nothing, such as a method of a class. */
export function declaredNameOf(code: string): string | null {
    return DECLARES.exec(code)?.[1] ?? null;
}

/* What a workspace symbol is that a type name can mean. */
const TYPE_KINDS = new Set([2, 3, 5, 10, 11, 23, 26]);

interface Found {
    readonly name: string;
    readonly kind: number;
    readonly containerName?: string;
    readonly location: Location | { uri: string };
}

/*
 * The places a type name leads to among the symbols a server found for it. Only symbols of exactly that name
 * count, those that are types ahead of the rest, and when several are left the ones whose container (a
 * namespace) the current file names, which is how a file says which `Message` it means.
 */
export function placesOfName(result: WorkspaceSymbolResult, name: string, fileText: string): Location[] {
    const found: Found[] = ((result ?? []) as (SymbolInformation | WorkspaceSymbol)[]).filter((symbol) => symbol.name === name);
    const types = found.filter((symbol) => TYPE_KINDS.has(symbol.kind));
    let candidates = types.length > 0 ? types : found;
    if (candidates.length > 1) {
        const named = candidates.filter(
            (symbol) => symbol.containerName !== undefined && symbol.containerName !== '' && fileText.includes(symbol.containerName)
        );
        if (named.length > 0) {
            candidates = named;
        }
    }
    const seen = new Set<string>();
    return candidates
        .map((symbol): Location =>
            'range' in symbol.location
                ? symbol.location
                : { uri: symbol.location.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
        )
        .filter((location) => {
            const key = `${location.uri}\0${location.range.start.line}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}
