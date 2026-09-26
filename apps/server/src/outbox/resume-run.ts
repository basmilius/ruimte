import type { InterruptedRun } from '../chat/chat-manager.ts';
import { notResumedNote } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, ResumeRunEntry } from './outbox.ts';

export interface ResumeRunDeps {
    resumeRun(chatId: string, turnId: string, attempt: number): Promise<void>;
    abandonRun(chatId: string, turnId: string, reason: string): void;
}

export interface OweResumeDeps {
    // The project that places the chat, as a node on a canvas or as a view of its own; null for a chat no project holds, which nothing would resume for.
    projectOf(chatId: string): string | null;
    entries(): OutboxEntry[];
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
}

/*
 * Owes the resume of a turn the daemon went down in, once per turn and attempt. Loading the chat
 * again from the handler asks the same question and finds it owed. Only writes to the outbox, so
 * the chat that asks never runs the resume in its own call stack.
 */
export const oweResume =
    (deps: OweResumeDeps) =>
    async (run: InterruptedRun): Promise<boolean> => {
        const projectId = deps.projectOf(run.chatId);
        if (projectId === null) {
            return false;
        }
        const owed = deps
            .entries()
            .some(
                (entry) =>
                    entry.kind === 'resume-run' && entry.target === run.chatId && entry.payload.turnId === run.turnId && entry.payload.attempt === run.attempt
            );
        if (!owed) {
            await deps.enqueue(projectId, run.chatId, { kind: 'resume-run', payload: { turnId: run.turnId, attempt: run.attempt } });
        }
        return true;
    };

/* Takes the turn up again; a CLI that will not start throws, and the worker tries again after 1, 5 and 30 seconds. */
export const resumeRunHandler =
    (deps: Pick<ResumeRunDeps, 'resumeRun'>) =>
    (entry: ResumeRunEntry): Promise<void> =>
        deps.resumeRun(entry.target, entry.payload.turnId, entry.payload.attempt);

/* A resume given up on ends its turn as aborted, with the reason in the thread, instead of leaving it running forever. */
export const resumeRunParked =
    (deps: Pick<ResumeRunDeps, 'abandonRun'>) =>
    (entry: OutboxEntry, error: unknown): void => {
        if (entry.kind === 'resume-run') {
            deps.abandonRun(entry.target, entry.payload.turnId, notResumedNote(errorText(error)));
        }
    };
