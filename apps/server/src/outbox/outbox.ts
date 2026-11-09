import { OutboxStore as BaseOutboxStore, type OutboxEntryOf } from '@adecore/agents/coordination';
import { OutboxWorkSchema, traitsOf, type OutboxWork } from './kinds/index.ts';

export type { OutboxWork } from './kinds/index.ts';
export type OutboxEntry = OutboxEntryOf<OutboxWork>;
export type OutboxEntryOfKind<K extends OutboxWork['kind']> = Extract<OutboxEntry, { kind: K }>;
export type StartAgentEntry = OutboxEntryOfKind<'start-agent'>;
export type ResumeRunEntry = OutboxEntryOfKind<'resume-run'>;
export type WakeParentEntry = OutboxEntryOfKind<'wake-parent'>;
export type EndChildrenEntry = OutboxEntryOfKind<'end-children'>;
export type DeliverSummaryEntry = OutboxEntryOfKind<'deliver-summary'>;
export type DeliverPrWatchEntry = OutboxEntryOfKind<'deliver-pr-watch'>;
export type DeliverAnswerEntry = OutboxEntryOfKind<'deliver-answer'>;
export type RunAfterSettleEntry = OutboxEntryOfKind<'run-after-settle'>;
export type ConnectPeerEntry = OutboxEntryOfKind<'connect-peer'>;
export type StartRemoteAgentEntry = OutboxEntryOfKind<'start-remote-agent'>;
export type StopRemoteAgentEntry = OutboxEntryOfKind<'stop-remote-agent'>;
export type TakeRemoteResultEntry = OutboxEntryOfKind<'take-remote-result'>;
export type DeliverRemoteResultEntry = OutboxEntryOfKind<'deliver-remote-result'>;
export type RoutineRunEntry = OutboxEntryOfKind<'routine-run'>;

/* The machine a piece of work for another machine is owed to, or null for any other entry. */
export function machineOwed(entry: { kind: string; payload?: unknown }): string | null {
    const machineId = traitsOf(entry.kind).owedTo?.(entry.payload);
    return typeof machineId === 'string' ? machineId : null;
}

/* Work the daemon still owes, under `$RUIMTE_HOME/outbox`. The kinds, and which are due later, are in `kinds.ts` and this folder's CLAUDE.md. */
export class OutboxStore extends BaseOutboxStore<OutboxWork> {
    constructor(home: string) {
        super({
            dataDir: home,
            work: OutboxWorkSchema,
            lanesOf: (entry) => traitsOf(entry.kind).lanes?.(entry) ?? [entry.target],
            outlivesTarget: (entry) => traitsOf(entry.kind).outlivesTarget
        });
    }

    /* What is owed of a kind to a target, oldest first; entry shapes stay in here and the feature that wrote them. */
    ofKind<K extends OutboxWork['kind']>(kind: K): OutboxEntryOfKind<K>[] {
        return this.list().filter((entry): entry is OutboxEntryOfKind<K> => entry.kind === kind);
    }

    /* Everything owed to a target, whatever its kind, oldest first. */
    ofTarget(target: string): OutboxEntry[] {
        return this.list().filter((entry) => entry.target === target);
    }

    /* What is owed of any of these kinds, oldest first. */
    ofKinds<K extends OutboxWork['kind']>(...kinds: readonly K[]): OutboxEntryOfKind<K>[] {
        return this.list().filter((entry): entry is OutboxEntryOfKind<K> => (kinds as readonly string[]).includes(entry.kind));
    }

    /* The oldest entry of a kind owed to a target, if any. */
    owed<K extends OutboxWork['kind']>(kind: K, target: string): OutboxEntryOfKind<K> | undefined {
        return this.ofKind(kind).find((entry) => entry.target === target);
    }

    owes(kind: OutboxWork['kind'], target: string): boolean {
        return this.owed(kind, target) !== undefined;
    }

    /* The targets of the work owed to another machine: a task given to it, its result, a stop. */
    targetsOwedTo(machineId: string): string[] {
        return this.list().flatMap((entry) => (machineOwed(entry) === machineId ? [entry.target] : []));
    }
}
