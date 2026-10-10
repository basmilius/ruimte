import { createStore, type StoreApi } from 'zustand';
import type { AgentKind, ProvenanceReadResult, ProvenanceRun } from '@ruimte/contracts';
import type { Editor, EditorContentChange, EditorTrackedRange } from '@adecore/editor';
import { highlightLayers, RowHost, type HostedRow } from '@adecore/editor-react';
import { planConflict, replaceAllLines, replaceLines, type ConflictStretch } from '@adecore/editor-react/models';
import type { DiskText } from '@/state/text-drafts';
import { useConflictInfo } from './conflict-info';

const ROW_OWNER = 'conflict';
const LAYER_OWNER = 'conflict';

/* The code line height a row is given until the editor has measured it. */
const LINE_PX = 20;
const HEADER_PX = 24;

/* Who wrote the other side of a block, as far as the runs of the file say. */
export interface ConflictAuthor {
    chatId: string;
    turn?: number;
    provider?: AgentKind;
}

export interface ConflictBlockState {
    id: string;
    theirs: readonly string[];
    /* The number of the first of `theirs` in the incoming file. */
    theirsFirstLine: number;
    /* Whether the block has no line of ours left, which a person removed or never had. */
    oursEmpty: boolean;
    author: ConflictAuthor | null;
}

export interface ConflictState {
    blocks: readonly ConflictBlockState[];
}

export interface ConflictSource {
    /* The draft as it stands: the version the text started from, and the one that moved under it; null once there is no draft or nothing incoming. */
    versions(): { disk: string; incoming: DiskText } | null;
    /* Calls back whenever the draft changes. */
    onDraft(listener: () => void): () => void;
    /* Every block is answered: the text is what stays, and saves as usual. */
    resolve(merged: string): Promise<boolean>;
    /* The runs the daemon mapped onto the file on disk; null when it could not say. */
    runs(): Promise<ProvenanceReadResult | null>;
}

interface Boundary {
    range: EditorTrackedRange;
    /* The boundary stands at the end of a last line that has no break behind it, so the next line is one past it. */
    atEnd: boolean;
}

interface OpenBlock {
    id: string;
    stretch: ConflictStretch;
    start: Boundary;
    end: Boundary;
    author: ConflictAuthor | null;
}

interface Span {
    from: number;
    to: number;
}

function boundaryAt(editor: Editor, line: number): Boundary {
    const raw = editor.getText().split('\n');
    const atEnd = line >= raw.length;
    const position = atEnd ? { line: raw.length - 1, character: raw[raw.length - 1]!.length } : { line, character: 0 };
    return { range: editor.trackRange({ start: position, end: position }), atEnd };
}

function lineOf(boundary: Boundary): number | null {
    const range = boundary.range.get();
    return range === null ? null : range.start.line + (boundary.atEnd ? 1 : 0);
}

function untrack(block: OpenBlock): void {
    block.start.range.dispose();
    block.end.range.dispose();
}

/* The newest run that touches the lines, which is who wrote them as far as anyone knows. */
function authorOf(runs: readonly ProvenanceRun[], start: number, end: number): ProvenanceRun | null {
    let found: ProvenanceRun | null = null;
    for (const run of runs) {
        if (run.end < start || run.start > Math.max(end, start) || (found !== null && found.at >= run.at)) {
            continue;
        }
        found = run;
    }
    return found;
}

function authorFrom(run: ProvenanceRun | null): ConflictAuthor | null {
    return run === null
        ? null
        : { chatId: run.chatId, ...(run.turn === undefined ? {} : { turn: run.turn }), ...(run.provider === undefined ? {} : { provider: run.provider }) };
}

/*
 * What happens in an editor whose unsaved text the file on disk moved under. Nothing is overwritten:
 * what only the other side changed merges in as one undo step, and a stretch both changed gets a row
 * with both versions, so a person keeps theirs, the other side's or both. The draft keeps its problem
 * until the last row is answered, so nothing saves in between; the answer is the editor's own text.
 */
export class ConflictResolution {
    readonly store: StoreApi<ConflictState>;
    readonly rows: RowHost;
    private readonly editor: Editor;
    private readonly source: ConflictSource;
    private readonly key: string;
    private readonly stopDraft: () => void;
    private readonly stopText: () => void;
    private open: OpenBlock[] = [];
    private handled: number | null = null;
    private drawn = '';
    private replanning = false;
    private disposed = false;
    private runs: readonly ProvenanceRun[] = [];

    constructor(editor: Editor, source: ConflictSource, key: string) {
        this.editor = editor;
        this.source = source;
        this.key = key;
        this.rows = new RowHost(editor, ROW_OWNER);
        this.store = createStore<ConflictState>(() => ({ blocks: [] }));
        this.stopDraft = source.onDraft(() => this.weigh());
        this.stopText = editor.onTextChange(() => this.followText());
        this.weigh();
    }

    /* Merges what merges and asks about the rest, again from the text as it is now; for the Review button after the rows were lost. */
    review(): void {
        const versions = this.source.versions();
        if (versions !== null) {
            this.begin(versions.disk, versions.incoming);
        }
        this.revealFirst();
    }

    revealFirst(): void {
        const first = this.open[0];
        const span = first === undefined ? null : this.spanOf(first);
        if (span !== null) {
            this.editor.revealLine(span.from + 1);
        }
    }

    keepYours(id: string): void {
        this.answer(id, () => null);
    }

    keepTheirs(id: string): void {
        this.answer(id, (block, span) => replaceLines(this.editor.getText(), { from: span.from, to: span.to, lines: block.stretch.theirs }));
    }

    keepBoth(id: string): void {
        this.answer(id, (block, span) => replaceLines(this.editor.getText(), { from: span.to, to: span.to, lines: block.stretch.theirs }));
    }

    /* The runs of the file are in, or changed: each block names the newest run that wrote its lines. */
    async refreshAuthors(): Promise<void> {
        const handled = this.handled;
        const result = await this.source.runs().catch(() => null);
        if (result === null || this.disposed || handled !== this.handled || result.mtime !== handled) {
            return;
        }
        this.runs = result.runs;
        for (const block of this.open) {
            block.author = authorFrom(authorOf(result.runs, block.stretch.theirsStart, block.stretch.theirsEnd));
        }
        this.publish();
    }

    dispose(): void {
        this.disposed = true;
        this.stopDraft();
        this.stopText();
        this.close();
        useConflictInfo.getState().forget(this.key);
    }

    private weigh(): void {
        const versions = this.source.versions();
        if (versions === null) {
            if (this.handled !== null) {
                this.handled = null;
                this.close();
                this.publish();
            }
            return;
        }
        if (versions.incoming.mtime !== this.handled) {
            this.begin(versions.disk, versions.incoming);
        }
    }

    private begin(base: string, incoming: DiskText): void {
        this.close();
        this.handled = incoming.mtime;
        const text = this.editor.getText();
        const plan = planConflict(base, text, incoming.text);
        if (plan.merges.length > 0 && !this.editor.applyEdits(replaceAllLines(text, plan.merges))) {
            this.publish();
            return;
        }
        this.open = plan.conflicts.map((stretch, index) => ({
            id: `${incoming.mtime}:${index}`,
            stretch,
            start: boundaryAt(this.editor, stretch.from),
            end: boundaryAt(this.editor, stretch.to),
            author: authorFrom(authorOf(this.runs, stretch.theirsStart, stretch.theirsEnd))
        }));
        if (this.open.length === 0) {
            void this.finish();
            return;
        }
        this.draw();
        void this.refreshAuthors();
    }

    /* The block is answered by an edit of the editor, which is one undo step, or by none for Keep yours. */
    private answer(id: string, edit: (block: OpenBlock, span: Span) => EditorContentChange | null): void {
        const block = this.open.find((candidate) => candidate.id === id);
        const span = block === undefined ? null : this.spanOf(block);
        if (block === undefined || span === null) {
            return;
        }
        const change = edit(block, span);
        if (change !== null && !this.editor.applyEdits([change])) {
            return;
        }
        this.dissolve(block);
        if (this.open.length === 0) {
            void this.finish();
        } else {
            this.draw();
        }
    }

    private async finish(): Promise<void> {
        this.close();
        this.publish();
        await this.source.resolve(this.editor.getText());
    }

    /* A person typing moves the rows with their lines; an edit across a block's edge loses the block, which is planned again from the text. */
    private followText(): void {
        if (this.open.length === 0 || this.replanning) {
            return;
        }
        if (this.open.some((block) => this.spanOf(block) === null)) {
            this.replanning = true;
            queueMicrotask(() => {
                this.replanning = false;
                if (!this.disposed) {
                    this.review();
                }
            });
            return;
        }
        this.draw();
    }

    private spanOf(block: OpenBlock): Span | null {
        const from = lineOf(block.start);
        const to = lineOf(block.end);
        return from === null || to === null ? null : { from, to: Math.max(from, to) };
    }

    private dissolve(block: OpenBlock): void {
        untrack(block);
        this.open = this.open.filter((candidate) => candidate !== block);
    }

    private close(): void {
        this.drawn = '';
        this.open.forEach(untrack);
        this.open = [];
        this.rows.clear();
        highlightLayers(this.editor).set(LAYER_OWNER, null);
        this.store.setState({ blocks: [] });
    }

    private publish(): void {
        const blocks = this.open.map<ConflictBlockState>((block) => {
            const span = this.spanOf(block);
            return {
                id: block.id,
                theirs: block.stretch.theirs,
                theirsFirstLine: block.stretch.theirsStart,
                oursEmpty: span === null || span.from === span.to,
                author: block.author
            };
        });
        this.store.setState({ blocks });
        const newest = this.open.map((block) => block.author).find((author) => author !== null) ?? authorFrom(this.newestRun());
        useConflictInfo.getState().set(this.key, this.handled === null ? null : { open: this.open.length, author: newest });
    }

    private newestRun(): ProvenanceRun | null {
        return this.runs.reduce<ProvenanceRun | null>((newest, run) => (newest === null || run.at > newest.at ? run : newest), null);
    }

    /* The rows and the tint, where the blocks stand now. */
    private draw(): void {
        const signature = this.open
            .map((block) => {
                const span = this.spanOf(block);
                return `${block.id}@${span?.from}-${span?.to}`;
            })
            .join('|');
        if (signature === this.drawn) {
            return;
        }
        this.drawn = signature;
        const rows: HostedRow[] = [];
        const lines = this.editor.getText().split('\n').length;
        for (const block of this.open) {
            const span = this.spanOf(block);
            if (span === null) {
                continue;
            }
            const theirsHeight = HEADER_PX + Math.max(1, block.stretch.theirs.length) * LINE_PX + HEADER_PX;
            if (span.to > span.from) {
                rows.push({ id: `${block.id}:yours`, line: span.from, placement: 'above', height: HEADER_PX });
                rows.push({ id: `${block.id}:theirs`, line: span.to - 1, placement: 'below', height: theirsHeight });
            } else {
                const placement = span.from < lines ? 'above' : 'below';
                const line = Math.min(span.from, lines - 1);
                rows.push({ id: `${block.id}:yours`, line, placement, height: HEADER_PX });
                rows.push({ id: `${block.id}:theirs`, line, placement, height: theirsHeight });
            }
        }
        this.rows.set(rows);
        highlightLayers(this.editor).set(LAYER_OWNER, () =>
            this.open.flatMap((block) => {
                const span = this.spanOf(block);
                return span === null || span.to === span.from ? [] : [{ startLine: span.from + 1, endLine: span.to, color: '--editor-modified' }];
            })
        );
        this.publish();
    }
}
