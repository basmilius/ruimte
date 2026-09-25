import type { ChatApprovalItem, ChatItem, ChatQuestionItem, Task } from '@ruimte/contracts';
import type { ChatRequestHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { errorText } from '../error-text.ts';
import type { DeliverWaitingEntry, OutboxWork } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { SessionEvent } from '../sessions/manager.ts';

/* What a child waits on: an answer anyone may give, or an approval only a person gives. */
export type WaitingRequest = ChatQuestionItem | ChatApprovalItem;

export const isPendingRequest = (item: ChatItem | null | undefined): item is WaitingRequest =>
    (item?.kind === 'question' && item.state === 'pending') || (item?.kind === 'approval' && item.decision === 'pending');

/* What `answer` reaches, read off the chats the daemon has loaded: a chat nobody loaded since a restart waits on nothing. */
export const chatRequests = (chats: Pick<ChatManager, 'get' | 'answer'>): ChatRequestHost => ({
    request: (nodeId, requestId) => {
        // The projector writes each under the kind it is.
        const thread = chats.get(nodeId)?.thread;
        const item = thread?.get(`question-${requestId}`) ?? thread?.get(`approval-${requestId}`);
        return item?.kind === 'question' || item?.kind === 'approval' ? item : null;
    },
    waiting: (nodeId) => (chats.get(nodeId)?.thread.list() ?? []).filter(isPendingRequest),
    answer: (nodeId, requestId, answers) => {
        try {
            chats.answer(nodeId, requestId, answers);
            return true;
        } catch {
            return false;
        }
    }
});

/* The id of the note one request of one child leaves in its parent, so delivering it twice leaves one. */
export const waitingNoteId = (childId: string, requestId: string): string => `waiting-${childId}-${requestId}`;

/*
 * How long a request may wait before its parent hears of it. A person watching the child settles one
 * within seconds (1.5 to 7 seconds in a run of Claude Code 2.1.282), and a note about that is stale
 * before the parent reads it.
 */
export const WAITING_GRACE_MS = 15_000;

export interface WaitingObserverDeps {
    openTask(childId: string): Task | undefined;
    enqueue(projectId: string, target: string, work: OutboxWork, notBefore: number): Promise<void>;
    now(): number;
    log?(message: string): void;
}

/*
 * Notes that a child with an open task asked something, and owes its parent one note in the outbox,
 * due once the request waited out `WAITING_GRACE_MS`. It never writes the note itself, since it runs
 * inside the broadcast of the child it heard, and it never wakes the parent: a finished task and a
 * message are the only things that wake a chat.
 */
export class WaitingObserver {
    private readonly deps: WaitingObserverDeps;
    // A pending item is upserted again as it changes; one entry per request is enough, and the handler is idempotent after a restart.
    private readonly owed = new Set<string>();
    private stopped = false;

    constructor(deps: WaitingObserverDeps) {
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
        if (chatEvent.type !== 'item' || !isPendingRequest(chatEvent.item)) {
            return;
        }
        const task = this.deps.openTask(chatId);
        const key = `${chatId}\n${chatEvent.item.requestId}`;
        if (task === undefined || this.owed.has(key)) {
            return;
        }
        this.owed.add(key);
        void this.deps
            .enqueue(
                task.projectId,
                task.parentId,
                { kind: 'deliver-waiting', payload: { childId: chatId, requestId: chatEvent.item.requestId } },
                this.deps.now() + WAITING_GRACE_MS
            )
            .catch((e: unknown) => (this.deps.log ?? console.error)(`Owing a note about ${chatId} failed: ${errorText(e)}`));
    }
}

const quoted = (text: string): string => JSON.stringify(text.replace(/\s+/g, ' ').trim());

/* The one line a note shows before "Show more": a question longer than that is read in the node. */
const NOTE_QUESTION_LENGTH = 200;

const quotedShort = (text: string): string => {
    const line = text.replace(/\s+/g, ' ').trim();
    return JSON.stringify(line.length > NOTE_QUESTION_LENGTH ? `${line.slice(0, NOTE_QUESTION_LENGTH - 1)}…` : line);
};

/* One question as the parent's CLI reads it, with the choices it may pick from. */
const questionLine = (question: ChatQuestionItem['questions'][number]): string => {
    const choices = question.choices.map((choice) => (choice.description === '' ? choice.label : `${choice.label} (${choice.description})`));
    const how =
        choices.length === 0
            ? 'answer in your own words'
            : `choices: ${choices.join(' | ')}; ${question.multiSelect ? 'pick one or more' : 'pick one'}, or answer in your own words`;
    return `- question ${question.id}: ${quoted(question.question)} (${how})`;
};

/* The call that answers it, in the shape the verb takes for this many questions. */
const answerCall = (childId: string, item: ChatQuestionItem): string => {
    if (item.questions.length === 1) {
        const multi = item.questions[0]!.multiSelect ? ', several labels in one --answer separated by a comma' : '';
        return `ruimte-context answer ${childId} ${item.requestId} --answer '<a choice label as written, or your own words>'${multi}`;
    }
    const shape = Object.fromEntries(item.questions.map((question) => [question.id, '...']));
    return `ruimte-context answer ${childId} ${item.requestId} --answers '${JSON.stringify(shape)}', one answer per question id`;
};

/*
 * What the parent's thread shows and what its CLI hears, from one request of one child. The note's
 * first line is what a person sees at a glance; under it, what the CLI hears in front of its next turn.
 */
export const waitingTexts = (child: { id: string; title: string }, item: WaitingRequest): { note: string; preamble: string } => {
    const who = `${child.title} (node ${child.id})`;
    if (item.kind === 'approval') {
        const what = item.description === null ? item.toolName : `${item.toolName}: ${item.description}`;
        return {
            note: `${who} waits for a person to approve ${what}`,
            preamble: [
                `Ruimte: ${who}, an agent you gave a task, waits for a person to approve ${what} (request ${item.requestId}). This did not wake you.`,
                'Only a person answers an approval; there is no verb for it. If it holds up your plan, tell the person.'
            ].join('\n')
        };
    }
    const asked = item.questions.length === 1 ? quotedShort(item.questions[0]!.question) : `${item.questions.length} questions`;
    const how = [
        ...item.questions.map(questionLine),
        `A person can answer it in that node, and this chat with ${answerCall(child.id, item)}. Whoever answers first wins; the verb refuses a question that was answered already.`
    ];
    return {
        note: [`${who} waits for an answer to ${asked}`, '', ...how].join('\n'),
        preamble: [
            `Ruimte: ${who}, an agent you gave a task, asked a question and waits for an answer (request ${item.requestId}). This did not wake you.`,
            ...how
        ].join('\n')
    };
};

export interface DeliverWaitingDeps {
    request: ChatRequestHost['request'];
    titleFor(nodeId: string): string | null;
    deliver(chatId: string, delivery: { noteId: string; note: string; preamble: string }): Promise<boolean>;
}

/*
 * Leaves the note in the parent, once. A request that no longer waits (answered, allowed, taken back
 * by its CLI, or cancelled by a restart) is news about nothing, so it says nothing.
 */
export const deliverWaitingHandler =
    (deps: DeliverWaitingDeps) =>
    async (entry: DeliverWaitingEntry): Promise<OutboxOutcome> => {
        const { childId, requestId } = entry.payload;
        const item = deps.request(childId, requestId);
        if (!isPendingRequest(item)) {
            return;
        }
        const texts = waitingTexts({ id: childId, title: deps.titleFor(childId) ?? childId }, item);
        await deps.deliver(entry.target, { noteId: waitingNoteId(childId, requestId), ...texts });
    };
