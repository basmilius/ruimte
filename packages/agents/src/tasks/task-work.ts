import { z } from 'zod';
import type { OutboxEntryOf, OutboxWorkShape } from '../outbox/outbox.ts';

export const BackgroundLimitWorkSchema = z.object({
    kind: z.literal('background-limit'),
    // The target is the child; the task its background commands hold open, and what they were when the limit started, for a child whose process went since.
    // `restarted` marks an entry an earlier run of the host owed, whose commands went down with it.
    payload: z.object({ taskId: z.string().min(1), commands: z.array(z.string()), restarted: z.literal(true).optional() })
});

export const WakeParentWorkSchema = z.object({
    kind: z.literal('wake-parent'),
    // The target is the chat to wake; the task that settled is only what owed it, since a wake takes every settled task.
    payload: z.object({ taskId: z.string().min(1) })
});

export const GiveTaskWorkSchema = z.object({
    kind: z.literal('give-task'),
    // The target is the agent the task went to; the record itself holds what it asks and who asked.
    payload: z.object({ taskId: z.string().min(1) })
});

export const DeliverWaitingWorkSchema = z.object({
    kind: z.literal('deliver-waiting'),
    // The target is the chat that gave the child its task; the child waits on this request of its own.
    payload: z.object({ childId: z.string().min(1), requestId: z.string().min(1) })
});

export type BackgroundLimitWork = z.infer<typeof BackgroundLimitWorkSchema>;
export type WakeParentWork = z.infer<typeof WakeParentWorkSchema>;
export type GiveTaskWork = z.infer<typeof GiveTaskWorkSchema>;
export type DeliverWaitingWork = z.infer<typeof DeliverWaitingWorkSchema>;

/* The work tasks owe, which a host puts in the discriminated union of its outbox beside its own kinds. */
export type TaskWork = BackgroundLimitWork | WakeParentWork | GiveTaskWork | DeliverWaitingWork;

export type BackgroundLimitEntry = OutboxEntryOf<BackgroundLimitWork>;
export type WakeParentEntry = OutboxEntryOf<WakeParentWork>;
export type GiveTaskEntry = OutboxEntryOf<GiveTaskWork>;
export type DeliverWaitingEntry = OutboxEntryOf<DeliverWaitingWork>;

/* An entry of whatever kinds a host owes, as tasks read its outbox. */
export type AnyOutboxEntry = OutboxEntryOf<OutboxWorkShape>;

/* The outbox of a host as tasks use it, whatever else the host owes in it. */
export interface TaskOutbox {
    /* Every entry the host owes, of any kind, oldest first. */
    list(): readonly AnyOutboxEntry[];
    /* `notBefore` is when the work is due; now without it. */
    enqueue(projectId: string, target: string, work: TaskWork, notBefore?: number): Promise<void>;
    remove(id: string): Promise<void>;
    /* The work of this target that answered `wait` may go on now. */
    wake(target: string): void;
}

export const isBackgroundLimit = (entry: AnyOutboxEntry): entry is BackgroundLimitEntry => entry.kind === 'background-limit';

export const isGiveTask = (entry: AnyOutboxEntry): entry is GiveTaskEntry => entry.kind === 'give-task';
