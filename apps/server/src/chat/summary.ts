import { isCanvasView, type ChatInfo, type ChatItem, type ChatSummarizeResult, type ChatTurnItem, type ProjectEdge } from '@ruimte/contracts';
import { newId } from '../canvas/nodes.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { errorText } from '../error-text.ts';
import type { DeliverSummaryEntry, OutboxEntry, OutboxWork } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import type { ChatManager } from './chat-manager.ts';
import { ChatError } from './errors.ts';

/* What the original reads of a summary; the fork itself is one read away for the rest. */
export const SUMMARY_MAX_BYTES = 8 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const turnsOf = (items: readonly ChatItem[]): ChatTurnItem[] => items.filter((item): item is ChatTurnItem => item.kind === 'turn');

/* The number a turn has in a thread, counted from one; null for a turn that is not in it. */
const turnNumber = (items: readonly ChatItem[], turnId: string): number | null => {
    const index = turnsOf(items).findIndex((turn) => turn.id === turnId);
    return index === -1 ? null : index + 1;
};

/* The last thing a turn said outside its subagents, which is its answer. */
export const answerOf = (items: readonly ChatItem[], turnId: string): string | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'assistant' && item.turnId === turnId && !item.parentToolUseId && item.text.trim() !== '') {
            return item.text.trim();
        }
    }
    return null;
};

const where = (place: IndexedPlace | null): 'node' | 'view' => (place?.canvasId === null ? 'view' : 'node');

export const summaryPrompt = (original: { id: string; kind: 'node' | 'view' }, after: number | null): string =>
    [
        `Ruimte: write a summary of what this conversation found out and decided since it was forked from ${original.kind} ${original.id}${after === null ? '' : ` after turn ${after}`}, for the agent that continues there.`,
        'At most 300 words. Say what changed in the files and where, what worked, what did not, and what is left; leave out what the original already knows. Do not run tools.'
    ].join(' ');

export interface SummarizeDeps {
    source(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null>;
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
    /* Opens the turn in the fork, loading it when nobody has; null while a turn is in the way. */
    openTurn(chatId: string, wake: { text: string; label: string; note: string; summaryFor: string }): Promise<string | null>;
}

/*
 * Asks a fork's own CLI to write down what it learned, in a turn of the fork a person sees and can
 * stop. The turn carries the chat it is for; the coordinator takes its last answer from there.
 */
export const summarizeFork = async (deps: SummarizeDeps, chatId: string): Promise<ChatSummarizeResult> => {
    const fork = await deps.source(chatId);
    if (fork === null) {
        throw new ChatError('chat-not-found', `No chat ${chatId}`);
    }
    const forkOf = fork.info.forkOf;
    if (forkOf === undefined) {
        throw new ChatError('not-a-fork', `${chatId} was not forked from another chat, so it has nothing to summarize for`);
    }
    const originalPlace = deps.locate(forkOf.chatId);
    if (originalPlace === null) {
        throw new ChatError('original-gone', 'The chat this one was forked from is no longer in the project');
    }
    if (fork.info.activeTurnId !== null) {
        throw new ChatError('chat-busy', 'The fork is working on a turn; ask for the summary once it ends');
    }
    const title = deps.titleFor(forkOf.chatId) ?? forkOf.chatId;
    const turnId = await deps.openTurn(chatId, {
        text: summaryPrompt({ id: forkOf.chatId, kind: where(originalPlace) }, turnNumber(fork.items, forkOf.turnId)),
        label: `Summary for ${title}`,
        note: `Writing a summary for ${title}`,
        summaryFor: forkOf.chatId
    });
    if (turnId === null) {
        throw new ChatError('chat-busy', 'The fork is working on a turn; ask for the summary once it ends');
    }
    return { turnId };
};

export interface SummaryCoordinatorDeps {
    chatItems(chatId: string): readonly ChatItem[] | null;
    projectOf(chatId: string): string | null;
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    log?(message: string): void;
}

/*
 * Notes that a fork finished the turn it wrote a summary in, and owes the original its delivery in
 * the outbox. It never delivers itself: it runs inside the broadcast of the fork it heard.
 */
export class SummaryCoordinator {
    private readonly deps: SummaryCoordinatorDeps;
    // A settled turn is upserted again (its diff, its tree); one entry per turn is enough, and the handler is idempotent after a restart.
    private readonly owed = new Set<string>();
    private stopped = false;

    constructor(deps: SummaryCoordinatorDeps) {
        this.deps = deps;
    }

    stop(): void {
        this.stopped = true;
    }

    /* For `chats.observe()`. */
    chatEvent(event: SessionEvent): void {
        if (this.stopped || event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chatEvent } = event.payload;
        if (chatEvent.type !== 'item' || chatEvent.item.kind !== 'turn') {
            return;
        }
        const turn = chatEvent.item;
        if (turn.summaryFor === undefined || turn.state !== 'done' || this.owed.has(turn.id)) {
            return;
        }
        const text = answerOf(this.deps.chatItems(chatId) ?? [], turn.id);
        const projectId = this.deps.projectOf(turn.summaryFor);
        if (text === null || projectId === null) {
            return;
        }
        this.owed.add(turn.id);
        void this.deps
            .enqueue(projectId, turn.summaryFor, { kind: 'deliver-summary', payload: { forkId: chatId, turnId: turn.id, text } })
            .catch((e: unknown) => (this.deps.log ?? console.error)(`Owing the summary of ${chatId} failed: ${errorText(e)}`));
    }
}

/* The first `bytes` of a text without cutting a character in half, and whether anything was left off. */
const cutAt = (text: string, bytes: number): { text: string; cut: boolean } => {
    const encoded = encoder.encode(text);
    if (encoded.length <= bytes) {
        return { text, cut: false };
    }
    return { text: decoder.decode(encoded.slice(0, bytes)).replace(/\uFFFD$/, ''), cut: true };
};

/* What the original's thread shows and what its CLI hears, from one summary. */
export const summaryTexts = (
    summary: string,
    fork: { id: string; title: string; kind: 'node' | 'view' },
    after: number | null
): { note: string; preamble: string } => {
    const { text, cut } = cutAt(summary, SUMMARY_MAX_BYTES);
    const read = `ruimte-context read ${fork.id}`;
    const body = cut ? `${text}\n\n[The summary was cut at ${SUMMARY_MAX_BYTES / 1024} KiB; ${read} shows the whole fork.]` : text;
    return {
        note: `Summary from fork ${fork.title} (${fork.kind} ${fork.id})\n\n${body}`,
        preamble: [
            `Ruimte: a fork of this conversation, ${fork.kind} ${fork.id} ("${fork.title}"), forked${after === null ? '' : ` after your turn ${after}`}, reports what it found:`,
            '',
            body,
            '',
            `(The whole fork is readable with ${read}.)`
        ].join('\n')
    };
};

export interface DeliverSummaryDeps {
    source(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null>;
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
    mutate: CanvasHost['mutate'];
    /* Leaves the note and the preamble in the original; false when it was there already. */
    deliver(chatId: string, summary: { noteId: string; note: string; from: string; preamble: string }): Promise<boolean>;
    /* A warning in a chat's thread, loading it when nobody has. */
    note(chatId: string, text: string): Promise<void>;
}

/* The id the note of one summary is written under, so delivering it twice leaves one. */
export const summaryNoteId = (turnId: string): string => `summary-${turnId}`;

/*
 * Brings a summary to the chat it is for: a line from the fork back into the original when both are
 * nodes of one canvas, so the read the preamble points at works, then the note and the preamble.
 * The line goes first because it is looked for before it is drawn: a restart after the note would
 * otherwise never draw it. An original that is gone says so in the fork instead.
 */
export const deliverSummaryHandler =
    (deps: DeliverSummaryDeps) =>
    async (entry: DeliverSummaryEntry): Promise<OutboxOutcome> => {
        const originalId = entry.target;
        const { forkId, turnId, text } = entry.payload;
        const place = deps.locate(originalId);
        const original = place === null ? null : await deps.source(originalId);
        if (place === null || original === null) {
            await deps.note(forkId, `The summary could not be delivered: the chat it was for is no longer in the project.`);
            return;
        }
        const forkPlace = deps.locate(forkId);
        if (forkPlace !== null && forkPlace.projectId === place.projectId && forkPlace.canvasId !== null && forkPlace.canvasId === place.canvasId) {
            await deps.mutate(place.projectId, (content) => {
                const canvas = content.views.find((view) => view.id === place.canvasId);
                if (!canvas || !isCanvasView(canvas)) {
                    return { content: null, result: null };
                }
                const present = new Set(canvas.nodes.map((node) => node.id));
                if (!present.has(forkId) || !present.has(originalId) || canvas.edges.some((edge) => edge.from === forkId && edge.to === originalId)) {
                    return { content: null, result: null };
                }
                const edge: ProjectEdge = { id: newId('edge', content), from: forkId, to: originalId, label: 'context' };
                return {
                    content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges: [...canvas.edges, edge] } : view)) },
                    result: null
                };
            });
        }
        const fork = await deps.source(forkId);
        const after = fork?.info.forkOf === undefined ? null : turnNumber(original.items, fork.info.forkOf.turnId);
        const texts = summaryTexts(text, { id: forkId, title: deps.titleFor(forkId) ?? forkId, kind: where(forkPlace) }, after);
        await deps.deliver(originalId, { noteId: summaryNoteId(turnId), note: texts.note, from: forkId, preamble: texts.preamble });
    };

/* A delivery the outbox gave up on is said in the fork that wrote the summary. */
export const deliverSummaryParked =
    (deps: Pick<DeliverSummaryDeps, 'note' | 'titleFor'>) =>
    (entry: OutboxEntry, error: unknown): void => {
        if (entry.kind !== 'deliver-summary') {
            return;
        }
        const title = deps.titleFor(entry.target) ?? entry.target;
        void deps
            .note(entry.payload.forkId, `The summary could not be delivered to ${title}: ${errorText(error)}`)
            .catch((e: unknown) => console.error(`Leaving a note in ${entry.payload.forkId} failed:`, errorText(e)));
    };

export interface SummaryWiring {
    coordinator: SummaryCoordinator;
    handler: (entry: DeliverSummaryEntry) => Promise<OutboxOutcome>;
    onParked(entry: OutboxEntry, error: unknown): void;
    summarize(chatId: string): Promise<ChatSummarizeResult>;
}

/* The summaries of the daemon in one place, wired the same for `daemon.ts` and the test daemon. */
export const wireSummaries = (wiring: {
    chats: ChatManager;
    host: Pick<CanvasHost, 'locate' | 'mutate'>;
    titleFor(id: string): string | null;
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
}): SummaryWiring => {
    const coordinator = new SummaryCoordinator({
        chatItems: (chatId) => wiring.chats.get(chatId)?.thread.list() ?? null,
        projectOf: (chatId) => wiring.host.locate(chatId)?.projectId ?? null,
        enqueue: wiring.enqueue
    });
    wiring.chats.observe((event) => coordinator.chatEvent(event));
    const deps: DeliverSummaryDeps = {
        source: (chatId) => wiring.chats.forkSource(chatId),
        locate: (id) => wiring.host.locate(id),
        titleFor: wiring.titleFor,
        mutate: (projectId, apply) => wiring.host.mutate(projectId, apply),
        deliver: (chatId, summary) => wiring.chats.deliverNote(chatId, summary),
        note: (chatId, text) => wiring.chats.addNote(chatId, 'warning', text)
    };
    return {
        coordinator,
        handler: deliverSummaryHandler(deps),
        onParked: deliverSummaryParked(deps),
        summarize: (chatId) =>
            summarizeFork(
                {
                    source: deps.source,
                    locate: deps.locate,
                    titleFor: deps.titleFor,
                    openTurn: (id, wake) => wiring.chats.openSummaryTurn(id, wake)
                },
                chatId
            )
    };
};
