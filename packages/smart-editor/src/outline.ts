import type { DocumentChange, FoldingRange } from '@ruimte/smart-editor-core';
import { mapOffset } from './offsets.ts';
import type { EditorBlock } from './types.ts';

/* A block with a header line, in zero-based lines and both ends inclusive. */
export interface OutlineBlock {
    startLine: number;
    endLine: number;
    /* What a breadcrumb calls it. Blocks of the editor's own structure only have one when their header declares something. */
    name?: string;
    kind?: string;
}

interface OutlineEntry {
    /* The start of the header line and the end of the last line, so an edit inside moves them along. */
    from: number;
    to: number;
    name?: string;
    kind?: string;
}

export interface OutlineDocument {
    getLine(line: number): { start: number; end: number; text: string };
    positionAt(offset: number): { line: number };
    getLineCount(): number;
}

const MODIFIERS =
    '(?:export\\s+|default\\s+|declare\\s+|abstract\\s+|async\\s+|pub(?:\\([^)]*\\))?\\s+|public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+|readonly\\s+|override\\s+|unsafe\\s+|extern\\s+)*';
const DECLARATION = new RegExp(
    `^${MODIFIERS}(function\\*?|class|interface|enum|type|namespace|module|trait|impl|struct|fn|def|func|object|record)\\s+([A-Za-z_$][\\w$]*)`
);
const VARIABLE = new RegExp(`^${MODIFIERS}(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)`);
const KEYWORDS = new Set([
    'if',
    'for',
    'while',
    'switch',
    'catch',
    'function',
    'return',
    'else',
    'with',
    'do',
    'try',
    'new',
    'await',
    'typeof',
    'super',
    'finally'
]);
const METHOD = /^(?:(?:public|private|protected|static|async|get|set|override|readonly|abstract)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*[(<]/;
const PROPERTY = /^["']?([\w$-]+)["']?\s*:\s*[{[(]?$/;
const KINDS: Record<string, string> = {
    'function*': 'function',
    fn: 'function',
    def: 'function',
    func: 'function',
    object: 'class',
    record: 'class',
    struct: 'class',
    trait: 'interface',
    impl: 'class'
};
const LABEL_LIMIT = 48;

/* What a header line declares, when it declares something a person would look for by name. */
export function describeHeader(text: string): { name?: string; kind?: string } {
    const line = text.trim();
    const declaration = DECLARATION.exec(line);
    if (declaration) {
        return { name: declaration[2]!, kind: KINDS[declaration[1]!] ?? declaration[1]! };
    }
    const variable = VARIABLE.exec(line);
    if (variable) {
        return { name: variable[1]!, kind: 'variable' };
    }
    const method = METHOD.exec(line);
    if (method && !KEYWORDS.has(method[1]!)) {
        return { name: method[1]!, kind: 'method' };
    }
    const property = PROPERTY.exec(line);
    return property ? { name: property[1]!, kind: 'property' } : {};
}

/* The header line as a label: what a breadcrumb shows for a block that declares nothing. */
export function headerLabel(text: string): string {
    const label = text.trim().replace(/[\s{(:]+$/, '');
    return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
}

/*
 * The blocks a language-less editor can tell from brackets and indentation: braces and indented
 * stretches, each headed by the line it opens on. A header that only closes a parameter list is
 * headed by the line the list opens on, so the signature of a function is the header and not its tail.
 */
export function structuralEntries(
    ranges: readonly FoldingRange[],
    document: OutlineDocument,
    slice: (from: number, to: number) => string,
    mate: (offset: number) => number | undefined
): OutlineEntry[] {
    const entries: OutlineEntry[] = [];
    for (const range of ranges) {
        if (range.kind === 'comment' || (range.kind === 'bracket' && slice(range.from, range.from + 1) !== '{')) {
            continue;
        }
        let headerLine = range.startLine;
        const header = document.getLine(headerLine);
        const lead = header.text.length - header.text.trimStart().length;
        if (/^[)\]]/.test(header.text.slice(lead))) {
            const opener = mate(header.start + lead);
            if (opener !== undefined && opener < header.start) {
                headerLine = document.positionAt(opener).line;
            }
        }
        const start = document.getLine(headerLine);
        entries.push({ from: start.start, to: document.getLine(range.endLine).end, ...describeHeader(start.text) });
    }
    return entries;
}

function toEditorLines(entry: OutlineEntry, document: OutlineDocument): OutlineBlock {
    const startLine = document.positionAt(entry.from).line;
    return {
        startLine,
        endLine: Math.max(startLine, document.positionAt(entry.to).line),
        ...(entry.name === undefined ? {} : { name: entry.name }),
        ...(entry.kind === undefined ? {} : { kind: entry.kind })
    };
}

/*
 * The blocks the editor knows the document by: its own reading of the structure, or the host's
 * where it has better, such as a language server's symbols. Ends are offsets, so an edit keeps
 * them on their lines until the next reading.
 */
export class Outline {
    private structure: OutlineEntry[] = [];
    private provided: OutlineEntry[] | null = null;
    private version = 0;
    private cache: { version: number; blocks: OutlineBlock[] } | undefined;

    setStructure(entries: OutlineEntry[]): void {
        this.structure = entries;
        this.version++;
    }

    /* Blocks the host drew from its own source, in one-based lines; null goes back to the structure. */
    setProvided(blocks: readonly EditorBlock[] | null, document: OutlineDocument): void {
        this.version++;
        if (blocks === null) {
            this.provided = null;
            return;
        }
        const last = document.getLineCount() - 1;
        const clamp = (line: number): number => Math.min(last, Math.max(0, Math.trunc(line) - 1));
        this.provided = blocks.map((block) => {
            const start = document.getLine(clamp(block.startLine));
            const header = block.name === undefined ? headerLabel(start.text) : block.name;
            return {
                from: start.start,
                to: document.getLine(Math.max(clamp(block.startLine), clamp(block.endLine))).end,
                name: header,
                ...(block.kind === undefined ? {} : { kind: block.kind })
            };
        });
    }

    edited(batches: readonly (readonly DocumentChange[])[]): void {
        const move = (entries: OutlineEntry[]): OutlineEntry[] =>
            entries.map((entry) => {
                let from = entry.from;
                let to = entry.to;
                for (const changes of batches) {
                    from = mapOffset(from, changes);
                    to = mapOffset(to, changes);
                }
                return { ...entry, from, to };
            });
        this.structure = move(this.structure);
        this.provided = this.provided === null ? null : move(this.provided);
        this.version++;
    }

    /* Outermost first. Of two blocks that start on one line, only the larger one. */
    blocks(document: OutlineDocument): readonly OutlineBlock[] {
        if (this.cache?.version !== this.version) {
            const sorted = (this.provided ?? this.structure)
                .map((entry) => toEditorLines(entry, document))
                .sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
            this.cache = { version: this.version, blocks: sorted.filter((block, index) => index === 0 || block.startLine !== sorted[index - 1]!.startLine) };
        }
        return this.cache.blocks;
    }
}

/* Where the rows of the document are, which the pinned headers are placed by. */
export interface StickyRows {
    /* The top and the bottom of the row a line is drawn in. */
    top(line: number): number;
    bottom(line: number): number;
    /* Whether the line starts a row of its own, which a line a fold hides does not. */
    startsRow(line: number): boolean;
}

export interface StickyPlacement {
    block: OutlineBlock;
    /* How many headers are pinned above this one. */
    depth: number;
    /* Zero while the block goes on, then up to a row's height of pixels it is pushed out of the top by the end of its block. */
    offset: number;
}

/*
 * The headers pinned at the top, outermost first. A header is pinned from the moment its own row
 * reaches the place it would be pinned at, which is the one a row of its own is at when it comes
 * there, so it never jumps. At the end of its block the next row pushes it up and out.
 */
export function stickyPlacements(blocks: readonly OutlineBlock[], scrollTop: number, lineHeight: number, max: number, rows: StickyRows): StickyPlacement[] {
    const placements: StickyPlacement[] = [];
    for (let depth = 0; depth < max; depth++) {
        const pinnedAt = scrollTop + depth * lineHeight;
        const parent = placements.at(-1)?.block;
        const next = blocks.find(
            (block) =>
                (parent === undefined || (block.startLine > parent.startLine && block.endLine <= parent.endLine)) &&
                rows.startsRow(block.startLine) &&
                rows.top(block.startLine) < pinnedAt &&
                rows.bottom(block.endLine) > pinnedAt
        );
        if (next === undefined) {
            break;
        }
        placements.push({ block: next, depth, offset: Math.min(0, rows.bottom(next.endLine) - (pinnedAt + lineHeight)) });
    }
    return placements;
}

/* How far down from the top the pinned headers reach. */
export function stickyCover(placements: readonly StickyPlacement[], lineHeight: number): number {
    return Math.max(0, ...placements.map((placement) => (placement.depth + 1) * lineHeight + placement.offset));
}

/* The named blocks around a line, outermost first. */
export function scopeChain(blocks: readonly OutlineBlock[], line: number): OutlineBlock[] {
    return blocks.filter((block) => block.name !== undefined && block.startLine <= line && block.endLine >= line);
}
