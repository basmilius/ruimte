import { commentSyntax } from './languages.ts';
import type { FoldRole, FoldingRange } from './structure.ts';
import type { DocumentLine } from './rope.ts';

/* The words a line starts with when it brings another file in, by language. A language not listed here has no import list to fold. */
const IMPORT_WORDS = new Map<string, RegExp>();

function register(languages: string, words: string): void {
    // The word must stand alone, and `import(` and `import.meta` are expressions and not an import.
    const pattern = new RegExp(`^(?:${words})\\b(?![(.=,;:])`);
    for (const language of languages.split(' ')) {
        IMPORT_WORDS.set(language, pattern);
    }
}

register(
    'typescript javascript typescriptreact javascriptreact tsx jsx ts js mjs cjs mts cts vue svelte astro java kotlin scala groovy go swift dart haskell elm',
    'import'
);
register('python py', 'import|from');
register('php rust rs perl', 'use');
register('csharp cs', 'using');

/* Whether a line, without its indentation, brings another file in. */
export function isImportLine(language: string, trimmed: string): boolean {
    return IMPORT_WORDS.get(language.toLowerCase())?.test(trimmed) ?? false;
}

const REGION_START = /^\s*(?:\/\/|#|<!--|\/\*|--)\s*(?:#\s*)?region\b/;
const REGION_END = /^\s*(?:\/\/|#|<!--|\/\*|--)\s*(?:#\s*)?endregion\b/;

export interface LexicalFoldOptions {
    /* Each on unless false. */
    imports?: boolean;
    regions?: boolean;
    lineComments?: boolean;
}

function bracketDelta(text: string): number {
    let depth = 0;
    for (const character of text) {
        if (character === '{' || character === '(' || character === '[') {
            depth++;
        } else if (character === '}' || character === ')' || character === ']') {
            depth--;
        }
    }
    return depth;
}

/* A fold of whole lines, from the end of the first to the end of the last. */
export function rangeOf(
    startLine: number,
    endLine: number,
    getLine: (line: number) => DocumentLine,
    kind: FoldingRange['kind'],
    role?: FoldRole
): FoldingRange {
    const start = getLine(startLine);
    return {
        startLine,
        endLine,
        from: start.start + (start.text.length - start.text.trimStart().length),
        to: getLine(endLine).end,
        kind,
        ...(role === undefined ? {} : { role })
    };
}

/*
 * The folds that come from how lines begin and need no syntax tree: a run of lines that import, a run
 * of lines of line comments, and what sits between a `// region` line and its `// endregion`.
 */
export function lexicalFolds(lineCount: number, getLine: (line: number) => DocumentLine, language: string, options: LexicalFoldOptions = {}): FoldingRange[] {
    const result: FoldingRange[] = [];
    const id = language.toLowerCase();
    const words = options.imports === false ? undefined : IMPORT_WORDS.get(id);
    const marker = options.lineComments === false ? null : commentSyntax(id).line;
    const regions: number[] = [];
    let importStart = -1;
    let importEnd = -1;
    let commentStart = -1;
    let commentEnd = -1;
    const flushImports = (): void => {
        if (importStart !== -1 && importEnd > importStart) {
            result.push(rangeOf(importStart, importEnd, getLine, 'imports', 'imports'));
        }
        importStart = -1;
    };
    const flushComments = (): void => {
        if (commentStart !== -1 && commentEnd > commentStart) {
            result.push(rangeOf(commentStart, commentEnd, getLine, 'line-comments'));
        }
        commentStart = -1;
    };
    for (let line = 0; line < lineCount; line++) {
        const text = getLine(line).text;
        const trimmed = text.trimStart();
        const isRegionMarker = options.regions !== false && (REGION_START.test(text) || REGION_END.test(text));
        if (isRegionMarker) {
            flushComments();
            if (REGION_START.test(text)) {
                regions.push(line);
            } else {
                const start = regions.pop();
                if (start !== undefined && line > start) {
                    result.push(rangeOf(start, line, getLine, 'region', 'region'));
                }
            }
            continue;
        }
        if (marker !== null && trimmed.startsWith(marker)) {
            commentStart = commentStart === -1 ? line : commentStart;
            commentEnd = line;
        } else {
            flushComments();
        }
        if (words === undefined) {
            continue;
        }
        if (words.test(trimmed)) {
            let last = line;
            let depth = bracketDelta(text);
            while (depth > 0 && last + 1 < lineCount) {
                last++;
                depth += bracketDelta(getLine(last).text);
            }
            importStart = importStart === -1 ? line : importStart;
            importEnd = last;
            line = last;
        } else if (trimmed !== '' && !(marker !== null && trimmed.startsWith(marker))) {
            flushImports();
        }
    }
    flushComments();
    flushImports();
    return result;
}
