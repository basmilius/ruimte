import { splitLines } from '@adecore/merge';
import type { AgentKind, ProvenanceChangedEvent, ProvenanceReadResult, ProvenanceRun } from '@ruimte/contracts';
import type { Editor, EditorRect } from '@adecore/editor';
import { realTimers, type Timers } from '@/language/timers';
import type { AgentChangesMode } from '@/state/ai-settings';
import { colorOfChat, drawnRuns, lastWritten, removalRuns, type DrawnRun, type RemovalRun } from './agent-runs';

/* A pause in typing this long before the bars are worked out again, since that reads both texts. */
const REMAP_DELAY_MS = 200;

/* How long the card outlives the pointer leaving its bar, so the pointer can cross to a button in it. */
const CARD_GRACE_MS = 200;

/* Far past any line, which the editor reads as the end of it. */
const END_OF_LINE = 100_000;

/* The turn that is writing in this file right now. */
export interface LiveWriter {
    chatId: string;
    turnId: string;
}

export interface AgentHover {
    run: ProvenanceRun;
    startLine: number;
    endLine: number;
    /* The bar under the pointer, in the page's pixels. */
    rect: EditorRect;
}

export interface AgentChangesState {
    live: LiveWriter | null;
    hover: AgentHover | null;
}

/* What was drawn last, for a review that puts its rows on the same runs. */
export interface DrawFrame {
    mode: AgentChangesMode;
    live: LiveWriter | null;
    pieces: readonly DrawnRun[];
    removals: readonly RemovalRun[];
}

export interface AgentChangesSettings {
    mode: AgentChangesMode;
    /* Whether the gutter marks the lines an agent wrote; the chip and the cursor of a live turn show without it. */
    attribution: boolean;
}

export interface AgentChangesSource {
    read(): Promise<ProvenanceReadResult>;
    /* What is on disk as far as this client knows, or what moved under an unsaved draft, which is the text the daemon's runs are mapped onto when the mtimes agree. */
    disk(): { text: string; mtime: number } | null;
    /* What the cursor of a turn says. */
    nameOf(provider: AgentKind | undefined): string;
    /* The turn the machine says a chat is running: null when it runs none, undefined when this client does not know the chat. */
    activeTurn?(chatId: string): string | null | undefined;
}

/*
 * What an agent wrote in the file in an open editor: a bar in its color beside the lines, a card on the bar
 * with the chat, the turn and the prompt, and, while a turn writes, its named cursor at the last line it
 * wrote. The daemon records the runs; this maps them onto the text in the editor through the text on
 * disk, so unsaved edits are respected, and draws nothing in `off`.
 */
export class AgentChanges {
    private readonly editor: Editor;
    private readonly source: AgentChangesSource;
    private readonly timers: Timers;
    private readonly listeners = new Set<() => void>();
    private readonly frameListeners = new Set<(frame: DrawFrame) => void>();
    private readonly stopHover: () => void;
    private readonly stopChange: () => void;
    private settings: AgentChangesSettings = { mode: 'off', attribution: false };
    private state: AgentChangesState = { live: null, hover: null };
    private result: ProvenanceReadResult | null = null;
    private drawn = new Map<string, DrawnRun>();
    private frame: DrawFrame | null = null;
    private request = 0;
    private remapTimer: unknown = null;
    private hideTimer: unknown = null;
    private inCard = false;
    private disposed = false;

    constructor(editor: Editor, source: AgentChangesSource, timers: Timers = realTimers) {
        this.editor = editor;
        this.source = source;
        this.timers = timers;
        this.stopHover = editor.onAttributionHover((hover) => this.hovered(hover));
        this.stopChange = editor.onTextChange((change) => {
            this.timers.clear(this.remapTimer);
            // Text from disk is not typing: the bars should be on its lines as it lands.
            if (change.source === 'external') {
                this.draw();
                return;
            }
            this.remapTimer = this.timers.set(() => this.draw(), REMAP_DELAY_MS);
        });
    }

    getState = (): AgentChangesState => this.state;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /* Calls back with every drawing of the runs, and once now when there already is one. */
    onDraw(listener: (frame: DrawFrame) => void): () => void {
        this.frameListeners.add(listener);
        if (this.frame !== null) {
            listener(this.frame);
        }
        return () => {
            this.frameListeners.delete(listener);
        };
    }

    configure(settings: AgentChangesSettings): void {
        const was = this.settings;
        this.settings = settings;
        if (settings.mode === 'off') {
            this.result = null;
            this.request++;
            this.set({ live: null, hover: null });
            this.draw();
        } else if (was.mode === 'off') {
            this.refresh();
        } else {
            this.draw();
        }
    }

    /* Asks the daemon for the runs again and draws them once they are of the text the client has on disk. */
    refresh(): void {
        if (this.disposed || this.settings.mode === 'off') {
            return;
        }
        const request = ++this.request;
        this.source.read().then(
            (result) => {
                if (request === this.request && !this.disposed) {
                    this.result = result;
                    this.draw();
                }
            },
            () => undefined
        );
    }

    /* A turn started or finished writing in this file, or a review changed its runs. */
    changed(event: ProvenanceChangedEvent): void {
        if (this.settings.mode === 'off') {
            return;
        }
        const live = this.state.live;
        if (event.live) {
            this.set({ ...this.state, live: { chatId: event.chatId, turnId: event.turnId } });
        } else if (live !== null && live.chatId === event.chatId && live.turnId === event.turnId) {
            this.set({ ...this.state, live: null });
        }
        this.refresh();
    }

    /*
     * What the chats are doing changed. The end of a turn is an event, and a socket that was gone for it
     * says nothing afterwards, so the chip and the cursor of a turn the machine no longer runs go here.
     */
    chatsChanged(): void {
        const live = this.state.live;
        if (live === null || this.disposed) {
            return;
        }
        const running = this.source.activeTurn?.(live.chatId);
        if (running !== undefined && running !== live.turnId) {
            this.set({ ...this.state, live: null });
            this.draw();
        }
    }

    /* The card the pointer is in stays open, and the one it left closes after a moment. */
    holdCard(inside: boolean): void {
        this.inCard = inside;
        if (inside) {
            this.timers.clear(this.hideTimer);
        } else {
            this.scheduleHide();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.stopHover();
        this.stopChange();
        this.frameListeners.clear();
        this.timers.clear(this.remapTimer);
        this.timers.clear(this.hideTimer);
        this.editor.setAttributionMarks([]);
        this.editor.setRemoteCursors([]);
    }

    private set(state: AgentChangesState): void {
        this.state = state;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }

    private draw(): void {
        if (this.disposed) {
            return;
        }
        const { mode, attribution } = this.settings;
        const disk = this.source.disk();
        const diskLines = disk === null ? null : splitLines(disk.text);
        if (mode === 'off' || this.result === null || disk === null || diskLines === null) {
            this.drawn = new Map();
            this.editor.setAttributionMarks([]);
            this.editor.setRemoteCursors([]);
            this.emit({ mode, live: this.state.live, pieces: [], removals: [] });
            return;
        }
        if (this.state.live === null) {
            this.editor.setRemoteCursors([]);
        }
        // Runs of another version of the file would land on the wrong lines; the bars stay put until the read of this one comes.
        if (this.result.mtime !== disk.mtime || this.result.lines !== diskLines.length) {
            return;
        }
        const textLines = splitLines(this.editor.getText());
        const drawn = drawnRuns(this.result.runs, diskLines, textLines);
        this.drawn = new Map(drawn.map((piece) => [piece.markId, piece]));
        this.emit({ mode, live: this.state.live, pieces: drawn, removals: removalRuns(this.result.runs, diskLines, textLines) });
        this.editor.setAttributionMarks(
            attribution
                ? drawn.map((piece) => ({ id: piece.markId, startLine: piece.startLine, endLine: piece.endLine, color: colorOfChat(piece.run.chatId) }))
                : []
        );
        const live = this.state.live;
        const writing = live === null ? null : lastWritten(drawn, live.chatId, live.turnId);
        this.editor.setRemoteCursors(
            live === null || writing === null
                ? []
                : [
                      {
                          id: `${live.chatId}:${live.turnId}`,
                          position: { line: writing.endLine - 1, character: END_OF_LINE },
                          name: this.source.nameOf(writing.run.provider),
                          color: colorOfChat(live.chatId)
                      }
                  ]
        );
        const hover = this.state.hover;
        if (hover !== null && !drawn.some((piece) => piece.run.id === hover.run.id)) {
            this.set({ ...this.state, hover: null });
        }
    }

    private emit(frame: DrawFrame): void {
        this.frame = frame;
        for (const listener of [...this.frameListeners]) {
            listener(frame);
        }
    }

    private hovered(hover: { id: string; rect: EditorRect } | null): void {
        if (hover === null) {
            this.scheduleHide();
            return;
        }
        const piece = this.drawn.get(hover.id);
        if (piece === undefined) {
            return;
        }
        this.timers.clear(this.hideTimer);
        this.set({ ...this.state, hover: { run: piece.run, startLine: piece.startLine, endLine: piece.endLine, rect: hover.rect } });
    }

    private scheduleHide(): void {
        this.timers.clear(this.hideTimer);
        this.hideTimer = this.timers.set(() => {
            if (!this.inCard && this.state.hover !== null) {
                this.set({ ...this.state, hover: null });
            }
        }, CARD_GRACE_MS);
    }
}
