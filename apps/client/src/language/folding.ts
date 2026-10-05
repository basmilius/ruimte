import type { EditorFoldHints, EditorFoldRange, EditorFoldSymbol } from '@ruimte/smart-editor';
import type { DocumentSymbol, DocumentSymbolResult, FoldingRange, SymbolInformation } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { Refresher } from './refresher';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/foldingRange';
const PAUSE_MS = 500;

/* The kind of body a symbol has, by LSP symbol kind; a namespace, a property of a type or an enum member has none worth folding. */
const BODIES: Readonly<Record<number, EditorFoldSymbol['body']>> = {
    5: 'class',
    6: 'method',
    7: 'value',
    8: 'value',
    9: 'method',
    10: 'class',
    11: 'class',
    12: 'function',
    13: 'value',
    14: 'value',
    23: 'class'
};

function walk(symbols: readonly DocumentSymbol[], found: EditorFoldSymbol[]): void {
    for (const symbol of symbols) {
        const body = BODIES[symbol.kind];
        if (body !== undefined && symbol.range.end.line > symbol.range.start.line) {
            found.push({ range: symbol.range, body });
        }
        walk(symbol.children ?? [], found);
    }
}

/* The symbols that have a body of more than one line, as what the editor folds them by. */
export function foldSymbolsOf(result: DocumentSymbolResult): EditorFoldSymbol[] {
    const found: EditorFoldSymbol[] = [];
    if (result === null || result.length === 0) {
        return found;
    }
    if ('range' in result[0]!) {
        walk(result as DocumentSymbol[], found);
        return found;
    }
    for (const symbol of result as SymbolInformation[]) {
        const body = BODIES[symbol.kind];
        if (body !== undefined && symbol.location.range.end.line > symbol.location.range.start.line) {
            found.push({ range: symbol.location.range, body });
        }
    }
    return found;
}

/* The ranges a server folds that span more than one line. */
export function foldRangesOf(ranges: readonly FoldingRange[] | null): (EditorFoldRange & { kind?: string })[] {
    return (ranges ?? [])
        .filter((range) => range.endLine > range.startLine)
        .map((range) => ({ startLine: range.startLine, endLine: range.endLine, ...(range.kind === undefined ? {} : { kind: range.kind }) }));
}

/*
 * What the servers know about folding: the bodies of the symbols (read from the symbols the document already
 * has, so nothing is asked twice) and the ranges they fold, such as an element or a Markdown section. The
 * editor folds what the settings choose by them when the file opens, and keeps them with their text after.
 */
export class FoldingFeature {
    private symbols: EditorFoldSymbol[] = [];
    private ranges: (EditorFoldRange & { kind?: string })[] = [];
    private readonly refresher: Refresher;
    private readonly language: EditorLanguage;

    constructor(language: EditorLanguage, onSymbols: (listener: (result: DocumentSymbolResult) => void) => () => void, timers: Timers = realTimers) {
        this.language = language;
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                if (!project.service.supports(METHOD, uri)) {
                    return;
                }
                const ranges = await project.service.foldingRanges(uri, { signal });
                if (!signal.aborted) {
                    this.ranges = foldRangesOf(ranges);
                    this.publish();
                }
            },
            PAUSE_MS,
            timers
        );
        const symbols = onSymbols((result) => {
            this.symbols = foldSymbolsOf(result);
            this.publish();
        });
        const edits = editor.onTextChange(() => this.refresher.later());
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.refresher.now();
            }
        });
        language.onDispose(() => {
            symbols();
            edits();
            providers.dispose();
            this.refresher.dispose();
            editor.setFoldHints(null);
        });
    }

    private publish(): void {
        const hints: EditorFoldHints = { symbols: this.symbols, ranges: this.ranges };
        this.language.editor.setFoldHints(hints);
    }
}
