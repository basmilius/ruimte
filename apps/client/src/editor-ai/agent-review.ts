import { splitLines } from '@adecore/merge';
import { createStore, type StoreApi } from 'zustand';
import type { ProvenanceReviewState, ProvenanceRun } from '@ruimte/contracts';
import type { Editor } from '@adecore/editor';
import { lineRangeLabel, selectionBlock } from '@/chat/selection-to-chat';
import type { AgentChanges, DrawFrame } from './agent-changes';
import { registerAgentReview } from './agent-review-registry';
import { highlightLayers } from '@adecore/editor-react';
import { replaceAllLines, type LineReplacement } from '@adecore/editor-react/models';
import { ReviewGroup, type ReviewMember } from '@adecore/editor-react';
import { LineActionHost, RowHost, type HostedAction, type HostedRow } from '@adecore/editor-react';
import { replacedWords } from '@adecore/editor-react/models';

const ROW_OWNER = 'review';
const ACTION_OWNER = 'review';
const LAYER_OWNER = 'review';

/* What a row is given until the editor has measured it: a code line, the strip a removal with no lines of its own has, and the comment card. */
const LINE_PX = 20;
const STRIP_PX = 24;
const COMMENT_PX = 112;

/* The row of a run's comment card, which stands apart from the row of its removed lines. */
export function commentRowId(runId: string): string {
    return `${runId}:comment`;
}

export interface ReviewSource {
    /* Marks runs reviewed on the machine; a failure leaves them as they were. */
    mark(runIds: readonly string[], state: ProvenanceReviewState): Promise<void>;
    /* Puts text in a chat's draft, which nobody sends but the person. */
    offer(chatId: string, text: string): void;
    focusChat(chatId: string): void;
    chatExists(chatId: string): boolean;
    /* The file as a chat reads it, such as `src/score.ts`. */
    label(): string;
    /* The language of a code fence, when the file has one. */
    language(): string | null;
}

/* One run of an agent waiting for a person's answer, at the lines it stands on now. */
export interface ReviewItem {
    run: ProvenanceRun;
    /* One-based and inclusive; a run that only removed lines has `endLine` below `startLine`, which is the line it stood in front of. */
    startLine: number;
    endLine: number;
    /* The pieces of the run that are left, since an edit may have cut it. */
    spans: ReadonlyArray<{ startLine: number; endLine: number }>;
    /* Whether Undo can put the lines back: the run is whole, and the machine kept the lines it replaced. */
    undoable: boolean;
    /* Per removed line, the words the added lines replaced; empty where no line stands for another. */
    replaced: Array<Array<[number, number]>>;
}

export interface ReviewState {
    items: readonly ReviewItem[];
    /* The change a step landed on last, as an index into `items`. */
    current: number | null;
    /* The change whose comment is being typed. */
    commenting: { runId: string; text: string } | null;
}

/* The line that tells a chat what a person took back, which is theirs to send. */
export function revertNote(ranges: readonly string[]): string {
    return ranges.length === 1 ? `I reverted your change in ${ranges[0]}.` : `I reverted your changes in ${ranges.join(', ')}.`;
}

/*
 * Review mode of agent changes: once an agent's turn is done, each run of it has a row in the editor with
 * the lines it removed and Keep, Undo and Comment. Keep only marks the run, Undo puts the removed lines
 * back as one edit of the editor and tells the chat in its draft, and a comment goes to that draft with
 * the file and the lines. Nothing is sent: the draft is the person's own message.
 */
export class AgentReview implements ReviewMember {
    readonly store: StoreApi<ReviewState>;
    /* The rows of removed lines and of comment cards; the buttons of a change stand after its first line, in `actions`. */
    readonly rows: RowHost;
    readonly actions: LineActionHost;
    private readonly group: ReviewGroup;
    private readonly leaveGroup: () => void;
    private readonly editor: Editor;
    private readonly changes: AgentChanges;
    private readonly source: ReviewSource;
    private readonly stopDraw: () => void;
    /* Runs answered whose new state the machine has not confirmed yet, so their rows are gone at once. */
    private readonly settling = new Set<string>();
    private frame: DrawFrame | null = null;

    /* The group is the other editors on the same file in this window; one on its own has a group of one. */
    constructor(editor: Editor, changes: AgentChanges, source: ReviewSource, group: ReviewGroup = new ReviewGroup()) {
        this.editor = editor;
        this.changes = changes;
        this.source = source;
        this.group = group;
        this.leaveGroup = group.join(this);
        this.rows = new RowHost(editor, ROW_OWNER);
        this.actions = new LineActionHost(editor, ACTION_OWNER);
        this.store = createStore<ReviewState>(() => ({ items: [], current: null, commenting: null }));
        registerAgentReview(editor, this);
        this.stopDraw = changes.onDraw((frame) => this.sync(frame));
    }

    keep(runId: string): void {
        void this.settle([runId], 'kept');
    }

    keepAll(): void {
        void this.settle(
            this.store.getState().items.map((item) => item.run.id),
            'kept'
        );
    }

    undo(runId: string): void {
        const item = this.itemOf(runId);
        if (item !== undefined) {
            void this.undoItems([item]);
        }
    }

    undoAll(): void {
        void this.undoItems(this.store.getState().items.filter((item) => item.undoable));
    }

    openComment(runId: string): void {
        this.store.setState({ commenting: { runId, text: '' } });
        this.draw(this.store.getState().items);
    }

    setComment(text: string): void {
        const commenting = this.store.getState().commenting;
        if (commenting !== null) {
            this.store.setState({ commenting: { ...commenting, text } });
        }
    }

    closeComment(): void {
        this.store.setState({ commenting: null });
        this.draw(this.store.getState().items);
    }

    hide(runIds: readonly string[]): void {
        for (const id of runIds) {
            this.settling.add(id);
        }
        if (this.frame !== null) {
            this.sync(this.frame);
        }
    }

    show(runIds: readonly string[]): void {
        for (const id of runIds) {
            this.settling.delete(id);
        }
        if (this.frame !== null) {
            this.sync(this.frame);
        }
    }

    refresh(): void {
        this.changes.refresh();
    }

    /* The comment goes to the chat's draft with the file and the lines, and the chat comes into view to be sent from. */
    submitComment(): void {
        const commenting = this.store.getState().commenting;
        const item = commenting === null ? undefined : this.itemOf(commenting.runId);
        const text = commenting?.text.trim() ?? '';
        if (item === undefined || text === '') {
            return;
        }
        this.source.offer(item.run.chatId, `${selectionBlock(this.rangeLabel(item), this.linesOf(item).join('\n'), this.source.language())}\n${text}\n\n`);
        this.source.focusChat(item.run.chatId);
        this.closeComment();
    }

    /* The label a comment names: `score.ts:15` or `score.ts:15-20`. */
    rangeLabel(item: ReviewItem): string {
        return lineRangeLabel(this.source.label(), item.startLine, Math.max(item.startLine, item.endLine));
    }

    /* Moves to the next change after the caret, or the previous one before it, wrapping round the file. */
    step(direction: 1 | -1): void {
        const { items } = this.store.getState();
        if (items.length === 0) {
            return;
        }
        const caret = this.editor.getCaret().line + 1;
        const index = direction === 1 ? items.findIndex((item) => item.startLine > caret) : items.findLastIndex((item) => item.startLine < caret);
        const target = index === -1 ? (direction === 1 ? 0 : items.length - 1) : index;
        this.store.setState({ current: target });
        this.editor.revealLine(items[target]!.startLine);
    }

    dispose(): void {
        this.stopDraw();
        this.leaveGroup();
        registerAgentReview(this.editor, null);
        this.rows.clear();
        this.actions.clear();
        highlightLayers(this.editor).set(LAYER_OWNER, null);
    }

    private itemOf(runId: string): ReviewItem | undefined {
        return this.store.getState().items.find((item) => item.run.id === runId);
    }

    /* The lines of the editor a run stands on, or the lines it removed when it stands on none. */
    private linesOf(item: ReviewItem): string[] {
        if (item.endLine < item.startLine) {
            return [...(item.run.before ?? [])];
        }
        return splitLines(this.editor.getText()).slice(item.startLine - 1, item.endLine);
    }

    private sync(frame: DrawFrame): void {
        this.frame = frame;
        const items = frame.mode === 'review' ? this.itemsOf(frame) : [];
        const present = new Set(items.map((item) => item.run.id));
        for (const id of [...this.settling]) {
            if (!present.has(id)) {
                this.settling.delete(id);
            }
        }
        const visible = items.filter((item) => !this.settling.has(item.run.id));
        const state = this.store.getState();
        const commenting = state.commenting !== null && visible.some((item) => item.run.id === state.commenting!.runId) ? state.commenting : null;
        this.store.setState({ items: visible, current: state.current !== null && state.current < visible.length ? state.current : null, commenting });
        this.draw(visible);
    }

    /* The runs of settled turns that wait for an answer, in the order of the file. */
    private itemsOf(frame: DrawFrame): ReviewItem[] {
        const settled = (run: ProvenanceRun): boolean =>
            run.review === 'pending' && !(frame.live !== null && frame.live.chatId === run.chatId && frame.live.turnId === run.turnId);
        const items = new Map<string, ReviewItem>();
        for (const piece of frame.pieces) {
            if (!settled(piece.run)) {
                continue;
            }
            const found = items.get(piece.run.id);
            const span = { startLine: piece.startLine, endLine: piece.endLine };
            if (found === undefined) {
                items.set(piece.run.id, { run: piece.run, startLine: span.startLine, endLine: span.endLine, spans: [span], undoable: false, replaced: [] });
            } else {
                items.set(piece.run.id, {
                    ...found,
                    startLine: Math.min(found.startLine, span.startLine),
                    endLine: Math.max(found.endLine, span.endLine),
                    spans: [...found.spans, span]
                });
            }
        }
        for (const removal of frame.removals) {
            if (settled(removal.run)) {
                items.set(removal.run.id, {
                    run: removal.run,
                    startLine: removal.line + 1,
                    endLine: removal.line,
                    spans: [],
                    undoable: removal.run.before !== undefined,
                    replaced: []
                });
            }
        }
        const lines = splitLines(this.editor.getText());
        return [...items.values()]
            .map((item) => {
                if (item.spans.length !== 1) {
                    return item;
                }
                const whole = item.run.before !== undefined && this.whole(item);
                const replaced = whole ? replacedWords(item.run.before!, lines.slice(item.startLine - 1, item.endLine)) : [];
                return { ...item, undoable: whole, replaced };
            })
            .sort((left, right) => left.startLine - right.startLine);
    }

    /* A run an edit did not touch still stands on as many lines as the machine wrote. */
    private whole(item: ReviewItem): boolean {
        return item.endLine - item.startLine === item.run.end - item.run.start;
    }

    private draw(items: readonly ReviewItem[]): void {
        const raw = this.editor.getText().split('\n').length;
        const commenting = this.store.getState().commenting;
        const rows: HostedRow[] = [];
        const actions: HostedAction[] = [];
        for (const item of items) {
            const added = item.endLine >= item.startLine;
            const removed = item.run.before?.length ?? 0;
            if (added) {
                actions.push({ id: item.run.id, line: item.startLine - 1 });
            }
            // A removal with nothing added has no line to carry its buttons, so its row carries them.
            if (removed > 0 || !added) {
                const height = removed > 0 ? removed * LINE_PX : STRIP_PX;
                rows.push(
                    added
                        ? { id: item.run.id, line: item.startLine - 1, placement: 'above', height }
                        : this.behind(item.run.id, item.startLine - 1, raw, height)
                );
            }
            if (commenting?.runId === item.run.id) {
                rows.push(
                    added
                        ? { id: commentRowId(item.run.id), line: item.endLine - 1, placement: 'below', height: COMMENT_PX }
                        : this.behind(commentRowId(item.run.id), item.startLine - 1, raw, COMMENT_PX)
                );
            }
        }
        this.rows.set(rows);
        this.actions.set(actions);
        highlightLayers(this.editor).set(LAYER_OWNER, () =>
            this.store.getState().items.flatMap((item) => item.spans.map((span) => ({ ...span, color: '--editor-added', sign: '+' })))
        );
    }

    /* A row in front of the line a removal stood before, or under the last line when that was the end of the file. */
    private behind(id: string, line: number, count: number, height: number): HostedRow {
        return line < count ? { id, line, placement: 'above', height } : { id, line: count - 1, placement: 'below', height };
    }

    private async settle(runIds: readonly string[], state: ProvenanceReviewState): Promise<boolean> {
        if (runIds.length === 0) {
            return false;
        }
        this.group.hide(runIds);
        try {
            await this.source.mark(runIds, state);
        } catch {
            this.group.show(runIds);
            return false;
        }
        this.group.refresh();
        return true;
    }

    /* Puts every run's lines back in one edit, so one undo of the editor takes it all again. */
    private async undoItems(items: readonly ReviewItem[]): Promise<void> {
        const reverted = items.filter((item) => item.undoable && item.run.before !== undefined);
        if (reverted.length === 0) {
            return;
        }
        const replacements = reverted.map<LineReplacement>((item) =>
            item.endLine < item.startLine
                ? { from: item.startLine - 1, to: item.startLine - 1, lines: item.run.before! }
                : { from: item.startLine - 1, to: item.endLine, lines: item.run.before! }
        );
        if (!this.editor.applyEdits(replaceAllLines(this.editor.getText(), replacements))) {
            return;
        }
        const notes = new Map<string, string[]>();
        for (const item of reverted) {
            if (this.source.chatExists(item.run.chatId)) {
                notes.set(item.run.chatId, [...(notes.get(item.run.chatId) ?? []), this.rangeLabel(item)]);
            }
        }
        await this.settle(
            reverted.map((item) => item.run.id),
            'undone'
        );
        for (const [chatId, ranges] of notes) {
            this.source.offer(chatId, `${revertNote(ranges)}\n\n`);
        }
    }
}
