import type { EditorBlock } from '@ruimte/smart-editor';
import type { DocumentSymbol, DocumentSymbolResult, SymbolInformation } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { Refresher } from './refresher';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/documentSymbol';
const PAUSE_MS = 500;

/* The names a breadcrumb and a sticky header know a symbol kind by; a kind left out is not a block worth pinning. */
const KINDS: Record<number, string> = {
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    9: 'constructor',
    10: 'enum',
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'constant',
    23: 'struct'
};

function isHierarchical(symbols: readonly (DocumentSymbol | SymbolInformation)[]): symbols is DocumentSymbol[] {
    return symbols.length > 0 && 'range' in symbols[0]!;
}

function blockOf(name: string, kind: number, startLine: number, endLine: number): EditorBlock | null {
    const label = KINDS[kind];
    // A one-line symbol has no body to pin, and a property or an enum member is part of the block around it.
    return label === undefined || endLine <= startLine ? null : { startLine: startLine + 1, endLine: endLine + 1, name, kind: label };
}

function walk(symbols: readonly DocumentSymbol[], blocks: EditorBlock[]): void {
    for (const symbol of symbols) {
        const block = blockOf(symbol.name, symbol.kind, symbol.range.start.line, symbol.range.end.line);
        if (block !== null) {
            blocks.push(block);
        }
        walk(symbol.children ?? [], blocks);
    }
}

/* The multi-line symbols of a file as blocks, outermost first, in one-based lines. */
export function blocksOf(result: DocumentSymbolResult): EditorBlock[] {
    const blocks: EditorBlock[] = [];
    if (result === null || result.length === 0) {
        return blocks;
    }
    if (isHierarchical(result)) {
        walk(result, blocks);
    } else {
        for (const symbol of result as SymbolInformation[]) {
            const block = blockOf(symbol.name, symbol.kind, symbol.location.range.start.line, symbol.location.range.end.line);
            if (block !== null) {
                blocks.push(block);
            }
        }
    }
    return blocks.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
}

/*
 * The symbols of the file as the blocks sticky scroll and the breadcrumb go by, with their real names. Until
 * the first answer, and wherever no server has symbols, the editor reads blocks off the text itself.
 */
export class SymbolsFeature {
    private readonly refresher: Refresher;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                if (!project.service.supports(METHOD, uri)) {
                    return;
                }
                const result = await project.service.documentSymbols(uri, { signal });
                if (!signal.aborted) {
                    editor.setBlocks(result === null ? null : blocksOf(result));
                }
            },
            PAUSE_MS,
            timers
        );
        const edits = editor.onTextChange(() => this.refresher.later());
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.refresher.now();
            }
        });
        language.onDispose(() => {
            edits();
            providers.dispose();
            this.refresher.dispose();
            editor.setBlocks(null);
        });
    }
}
