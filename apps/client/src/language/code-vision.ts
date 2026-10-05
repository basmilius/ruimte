import { splitLines } from '@ruimte/merge';
import type { EditorCodeVision, EditorCodeVisionEntry } from '@ruimte/smart-editor';
import type { DocumentSymbolResult } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { type CodeVisionDeclaration, declarationsOf, usagesText } from './code-vision-model';
import { realTimers, type Timers } from './timers';

const REFERENCES = 'textDocument/references';
/* Lines asked about above and below what is in view, so a little scrolling stays inside what is counted. */
const MARGIN_LINES = 40;
/* References are the slowest question a server is asked here, so only this many are in flight at once. */
const MAX_PARALLEL = 3;
const SCROLL_PAUSE_MS = 150;
/* Past this many lines a file gets no rows at all, which is also what keeps blame and the walk of symbols cheap. */
export const MAX_LINES = 20_000;

export interface CodeVisionSettings {
    readonly usages: boolean;
    readonly authors: boolean;
}

/*
 * The rows above declarations: how often each is used and, once git has been asked, who wrote it. The
 * declarations come from the symbols the servers know, and a row holds its height from the first
 * answer on, empty until its entries are in, so the text never moves when they arrive. Counts are asked
 * lazily, for the declarations in view and a margin around them, a few at a time, and only after the
 * text has settled; an old count stays on its row until the new one is in.
 */
export class CodeVisionFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private settings: CodeVisionSettings = { usages: false, authors: false };
    private declarations: CodeVisionDeclaration[] = [];
    /* What the declarations were read from, so a count never outlives the text it was asked for. */
    private epoch = 0;
    private edited = false;
    private readonly counts = new Map<string, { count: number; epoch: number }>();
    private queue: CodeVisionDeclaration[] = [];
    /* What is being asked. A question cannot be taken back from the daemon, so none is dropped: scrolling away only empties the queue behind them. */
    private readonly running = new Map<string, AbortController>();
    /* Declarations a server could not count for this text, which are not asked again until it says it can. */
    private failed = new Set<string>();
    private scrollTimer: unknown;
    private publishing = false;
    private disposed = false;

    constructor(language: EditorLanguage, onSymbols: (listener: (result: DocumentSymbolResult) => void) => () => void, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor, project, uri } = language;
        const offs = [
            onSymbols((result) => this.read(result)),
            editor.onTextChange(() => {
                this.edited = true;
            }),
            editor.onViewChange(() => {
                this.timers.clear(this.scrollTimer);
                this.scrollTimer = this.timers.set(() => this.plan(), SCROLL_PAUSE_MS);
            })
        ];
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.failed.clear();
                this.publish();
                this.plan();
            }
        });
        language.onDispose(() => {
            this.disposed = true;
            for (const off of offs) {
                off();
            }
            providers.dispose();
            this.timers.clear(this.scrollTimer);
            for (const controller of this.running.values()) {
                controller.abort();
            }
            editor.setCodeVision([]);
        });
    }

    /* Which rows to draw, from the settings of the client. */
    configure(settings: CodeVisionSettings): void {
        if (settings.usages === this.settings.usages && settings.authors === this.settings.authors) {
            return;
        }
        this.settings = settings;
        this.publish();
        this.plan();
    }

    private read(result: DocumentSymbolResult): void {
        const { editor, languageId } = this.language;
        const lines = splitLines(editor.getText());
        this.edited = false;
        this.declarations =
            lines.length > MAX_LINES ? [] : declarationsOf(result, { lineCount: lines.length, lineAt: (line) => lines[line] ?? '', languageId });
        this.epoch++;
        this.failed.clear();
        this.publish();
        this.plan();
    }

    private get canCount(): boolean {
        return this.settings.usages && this.language.project.service.supports(REFERENCES, this.language.uri);
    }

    /* Queues the declarations in view whose count is not from the current text, nearest the top of the view first. */
    private plan(): void {
        if (this.disposed || this.edited || !this.canCount) {
            return;
        }
        const view = this.language.editor.getVisibleRange();
        const first = view.start.line - MARGIN_LINES;
        const last = view.end.line + MARGIN_LINES;
        this.queue = this.declarations
            .filter(
                (declaration) =>
                    declaration.usages &&
                    declaration.line >= first &&
                    declaration.line <= last &&
                    this.counts.get(declaration.id)?.epoch !== this.epoch &&
                    !this.running.has(declaration.id) &&
                    !this.failed.has(declaration.id)
            )
            .sort((left, right) => Math.abs(left.line - view.start.line) - Math.abs(right.line - view.start.line));
        while (this.running.size < MAX_PARALLEL && this.queue.length > 0) {
            void this.count(this.queue.shift()!);
        }
    }

    private async count(declaration: CodeVisionDeclaration): Promise<void> {
        const { project, uri } = this.language;
        const controller = new AbortController();
        this.running.set(declaration.id, controller);
        const epoch = this.epoch;
        try {
            const locations = await project.service.references(uri, declaration.position, false, { signal: controller.signal, parallel: true });
            if (!this.disposed && epoch === this.epoch) {
                this.counts.set(declaration.id, { count: distinctPlaces(locations ?? []), epoch });
                this.publish();
            }
        } catch {
            // A text that moved on is counted again from its own symbols; for a server that is not up the declaration waits for it to say so.
            if (epoch === this.epoch) {
                this.failed.add(declaration.id);
            }
        } finally {
            this.running.delete(declaration.id);
            this.plan();
        }
    }

    /* Said once for every change that lands in the same turn, since each is a pass over the rows of the layout. */
    private publish(): void {
        if (this.publishing) {
            return;
        }
        this.publishing = true;
        queueMicrotask(() => {
            this.publishing = false;
            if (!this.disposed) {
                this.language.editor.setCodeVision(this.rows());
            }
        });
    }

    private rows(): EditorCodeVision[] {
        const rows: EditorCodeVision[] = [];
        const taken = new Set<number>();
        const counted = this.canCount;
        for (const declaration of this.declarations) {
            const reserved = counted && declaration.usages;
            if (!reserved || taken.has(declaration.line)) {
                continue;
            }
            taken.add(declaration.line);
            const entries: EditorCodeVisionEntry[] = [];
            const known = this.counts.get(declaration.id);
            if (known !== undefined) {
                entries.push({ id: 'usages', text: usagesText(known.count), activate: () => void this.language.peek.open(declaration.position) });
            }
            rows.push({ id: declaration.id, line: declaration.line, entries });
        }
        return rows;
    }
}

/* The places a server named, each counted once however many ways it was reached. */
function distinctPlaces(locations: readonly { uri: string; range: { start: { line: number; character: number } } }[]): number {
    return new Set(locations.map((location) => `${location.uri}\0${location.range.start.line}\0${location.range.start.character}`)).size;
}
