import type { ChatItem, Task } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, WakeParentEntry } from '../outbox/outbox.ts';
import type { OutboxOutcome } from '../outbox/outbox-worker.ts';
import type { TaskStore } from './task-store.ts';

/* What the parent reads of one result; the rest stays with the child, whose id is right beside it. */
export const RESULT_PREVIEW_BYTES = 8 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* The first `bytes` of a text without cutting a character in half, and whether anything was left off. */
const cutAt = (text: string, bytes: number): { text: string; cut: boolean } => {
    const encoded = encoder.encode(text);
    if (encoded.length <= bytes) {
        return { text, cut: false };
    }
    return { text: decoder.decode(encoded.slice(0, bytes)).replace(/\uFFFD$/, ''), cut: true };
};

/*
 * The prompt a woken chat's CLI gets. Every task is named with its child's id, so the agent can go
 * on with that node (read it, notify it) without asking which one it was.
 */
export const wakePrompt = (tasks: readonly Task[], teamsOut = 0): string => {
    const head = tasks.length === 1 ? 'A task you gave has settled. Its result:' : `${tasks.length} tasks you gave have settled. Their results:`;
    const sections = tasks.map((task) => {
        const { text, cut } = cutAt(task.result?.text ?? '', RESULT_PREVIEW_BYTES);
        const lines = [`## ${task.title} (node ${task.childId}, task ${task.id}): ${task.status}`, '', text === '' ? '(no result text)' : text];
        if (cut) {
            lines.push(
                '',
                `[The result was cut at ${RESULT_PREVIEW_BYTES / 1024} KiB. ruimte-context read ${task.childId} shows the rest once a line runs from that node into you; ruimte-context link --to ${task.childId} draws it.]`
            );
        }
        return lines.join('\n');
    });
    const together = tasks.some((task) => task.batchId !== undefined)
        ? ['The tasks of one team call come in together, once every one of them has settled.']
        : [];
    const out =
        teamsOut === 0
            ? []
            : [
                  `${teamsOut === 1 ? 'A team you gave is' : `${teamsOut} teams you gave are`} still out: you are woken with all of a team's results once its last task settles.`
              ];
    return [head, ...sections, ...together, ...out].join('\n\n');
};

/* The label of the turn a wake opens: what a person reads above it in the thread. */
export const wakeLabel = (tasks: readonly Task[]): string => tasks.map((task) => task.title).join(', ');

export const wakeNote = (tasks: readonly Task[]): string => `Woken by ${tasks.length} finished ${tasks.length === 1 ? 'task' : 'tasks'}`;

export interface WakeChat {
    items(): ChatItem[];
    wake(wake: { text: string; label: string; note: string; taskIds: string[] }): boolean;
}

export interface WakeParentDeps {
    tasks: Pick<TaskStore, 'pendingWake' | 'readyWake' | 'openBatches' | 'markWoken' | 'dropWake'>;
    /* The chat as it is now, loading it from disk when nobody has; null for a chat that has no thread any more. */
    chat(chatId: string): Promise<WakeChat | null>;
}

/*
 * Wakes a chat once with every task of its that settled and has not woken it yet. A chat still in a
 * turn is waited for rather than retried: the outbox keeps the entry and a turn that ends looks again.
 * A task of a team whose other tasks are still open is held, and so is the entry: it waits until the
 * last task of that team settles, which owes an entry of its own or, cancelled, wakes this one. The
 * turn goes out before the tasks are marked, and a task a turn of the thread already names is marked
 * without a second turn, so a restart between the two wakes nobody twice.
 */
export const wakeParentHandler =
    (deps: WakeParentDeps) =>
    async (entry: WakeParentEntry): Promise<OutboxOutcome> => {
        const parentId = entry.target;
        const pending = deps.tasks.pendingWake(parentId);
        if (pending.length === 0) {
            return;
        }
        const held = (): OutboxOutcome => (deps.tasks.readyWake(parentId).length < deps.tasks.pendingWake(parentId).length ? 'wait' : undefined);
        // Nothing to say yet, so the chat is not loaded from disk for it.
        if (deps.tasks.readyWake(parentId).length === 0) {
            return held();
        }
        const chat = await deps.chat(parentId);
        if (chat === null) {
            await deps.tasks.dropWake(parentId);
            return;
        }
        const named = new Set(chat.items().flatMap((item) => (item.kind === 'turn' ? (item.taskIds ?? []) : [])));
        const already = deps.tasks.pendingWake(parentId).filter((task) => named.has(task.id));
        if (already.length > 0) {
            await deps.tasks.markWoken(already.map((task) => task.id));
        }
        const tasks = deps.tasks.readyWake(parentId).filter((task) => !named.has(task.id));
        if (tasks.length === 0) {
            return held();
        }
        const teamsOut = deps.tasks.openBatches(parentId).length;
        if (!chat.wake({ text: wakePrompt(tasks, teamsOut), label: wakeLabel(tasks), note: wakeNote(tasks), taskIds: tasks.map((task) => task.id) })) {
            return 'wait';
        }
        await deps.tasks.markWoken(tasks.map((task) => task.id));
        return held();
    };

export interface OweWakeDeps {
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
}

/* A settled task owes its parent a wake; one entry per task, and the first to run takes every task there is. */
export const oweWake = (deps: OweWakeDeps, task: Task): Promise<void> =>
    deps.enqueue(task.projectId, task.parentId, { kind: 'wake-parent', payload: { taskId: task.id } });

export interface ParkedNoteDeps {
    /* The chat that opened a node, or null for a node a person opened. */
    madeBy(nodeId: string): string | null;
    titleFor(nodeId: string): string | null;
    note(chatId: string, text: string): Promise<void>;
    /* Raises attention on a node, for a person who has to step in. */
    alert(nodeId: string, body: string): void;
}

/*
 * A piece of owed work the daemon gave up on is said in the thread of the chat it was for: the chat
 * that opened the node, or the chat a wake was for. Only in a chat, since a terminal has no thread.
 */
export const parkedNote =
    (deps: ParkedNoteDeps) =>
    (entry: OutboxEntry, error: unknown): void => {
        // A summary that was not delivered is said in its fork, by its own handler.
        if (entry.kind === 'deliver-summary') {
            return;
        }
        const chatId = entry.kind === 'wake-parent' ? entry.target : deps.madeBy(entry.target);
        if (chatId === null) {
            return;
        }
        const title = deps.titleFor(entry.target) ?? entry.target;
        const reason = errorText(error);
        const text =
            entry.kind === 'wake-parent'
                ? `The machine could not wake this chat with the results of its tasks: ${reason}`
                : entry.kind === 'start-agent'
                  ? `The machine could not start the agent in ${title} (${entry.target}): ${reason}`
                  : `The machine could not resume the turn of ${title} (${entry.target}) after a restart: ${reason}`;
        void deps.note(chatId, text).catch((e: unknown) => console.error(`Leaving a note in ${chatId} failed:`, errorText(e)));
        if (entry.kind === 'wake-parent') {
            deps.alert(chatId, text);
        }
    };
