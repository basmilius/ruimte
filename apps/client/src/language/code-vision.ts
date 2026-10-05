import { splitLines } from '@ruimte/merge';
import type { GitBlameResult } from '@ruimte/contracts';
import type { EditorCodeVision, EditorCodeVisionEntry, EditorRect } from '@ruimte/smart-editor';
import type { DocumentSymbolResult } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { type CodeAuthorship, authorsText, authorshipOf, mapBlame } from './code-authors';
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
 * What git says about the file: `pending` while it is being asked, so the rows are held for the authors
 * that will come, and the blame of the text on disk once it is in. Null where git has nothing to say.
 */
export type BlameSource =
    | { readonly kind: 'pending' }
    | { readonly kind: 'ready'; readonly blame: GitBlameResult; readonly base: string; openCommit?(hash: string): void };

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
    private blame: BlameSource | null = null;
    /* The text the declarations were read from, which the lines of their authors are counted in. */
    private lines: readonly string[] = [];
    private mapped: { blame: GitBlameResult; lines: Int32Array | null } | null = null;
    private readonly authorships = new Map<string, CodeAuthorship>();
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
                this.closeAuthors();
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
            this.closeAuthors();
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

    /* What git says about the file, from the client that asked it. */
    setBlame(blame: BlameSource | null): void {
        this.blame = blame;
        this.mapped = null;
        this.authorships.clear();
        this.publish();
    }

    private read(result: DocumentSymbolResult): void {
        const { editor, languageId } = this.language;
        const lines = splitLines(editor.getText());
        this.lines = lines;
        this.mapped = null;
        this.authorships.clear();
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
        const withAuthors = this.settings.authors && this.blame !== null;
        const commits = this.blame?.kind === 'ready' ? this.blame.blame.commits : [];
        const mapped = this.blame?.kind === 'ready' && this.settings.authors ? this.mapOfBlame(this.blame) : null;
        for (const declaration of this.declarations) {
            const reserved = (counted && declaration.usages) || (withAuthors && declaration.authors);
            if (!reserved || taken.has(declaration.line)) {
                continue;
            }
            taken.add(declaration.line);
            const entries: EditorCodeVisionEntry[] = [];
            const known = this.counts.get(declaration.id);
            if (counted && declaration.usages && known !== undefined) {
                entries.push({ id: 'usages', text: usagesText(known.count), activate: () => void this.language.peek.open(declaration.position) });
            }
            if (mapped !== null && declaration.authors) {
                let authorship = this.authorships.get(declaration.id);
                if (authorship === undefined) {
                    authorship = authorshipOf(commits, mapped, this.lines, declaration.authorFrom, declaration.authorTo);
                    this.authorships.set(declaration.id, authorship);
                }
                const shown = authorship;
                entries.push({
                    id: 'authors',
                    text: authorsText(shown),
                    ...(shown.authors.length > 0 ? { icon: shown.authors.length > 1 ? ('users' as const) : ('user' as const) } : {}),
                    activate: (anchor) => this.showAuthors(declaration, shown, anchor)
                });
            }
            rows.push({ id: declaration.id, line: declaration.line, entries });
        }
        return rows;
    }

    private mapOfBlame(source: Extract<BlameSource, { kind: 'ready' }>): Int32Array | null {
        if (this.mapped?.blame !== source.blame) {
            this.mapped = { blame: source.blame, lines: mapBlame(source.blame, source.base, this.lines) };
        }
        return this.mapped.lines;
    }

    private showAuthors(declaration: CodeVisionDeclaration, authorship: CodeAuthorship, anchor: EditorRect): void {
        const source = this.blame;
        const openCommit = source?.kind === 'ready' ? source.openCommit : undefined;
        this.language.popups.setState({
            authors: {
                anchor,
                name: declaration.name,
                authorship,
                openCommit: openCommit === undefined || authorship.latest === null ? null : () => openCommit(authorship.latest!.hash)
            }
        });
    }

    /* Closes the card of the authors; `restoreFocus` is for a close that came from the keyboard, which gives the editor its keys back. */
    closeAuthors(restoreFocus = false): void {
        if (this.language.popups.getState().authors !== null) {
            this.language.popups.setState({ authors: null });
            if (restoreFocus) {
                this.language.editor.focus();
            }
        }
    }
}

/* The places a server named, each counted once however many ways it was reached. */
function distinctPlaces(locations: readonly { uri: string; range: { start: { line: number; character: number } } }[]): number {
    return new Set(locations.map((location) => `${location.uri}\0${location.range.start.line}\0${location.range.start.character}`)).size;
}
