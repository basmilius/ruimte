import { randomUUID } from 'node:crypto';
import type { SecretRequest } from '@ruimte/contracts';
import { realTimers, type Timers } from '../timers.ts';
import type { SecretSlot } from './secret-store.ts';

/*
 * How long a tool holds its call while the card is up, unless the agent asks for longer with `wait`.
 * Some agent CLIs end a shell command after 10 s unless the model asked for more; past this the agent
 * hears `waiting` and asks again, which joins the same card.
 */
export const SECRET_WAIT_MS = 6_000;

/* How long a card stands after the agent last asked: long enough to go and find a key, short enough that a card for an agent that gave up goes. */
export const SECRET_CARD_MS = 15 * 60_000;

export type SecretOutcome = 'saved' | 'declined' | 'cancelled' | 'timed-out' | 'waiting';

export interface SecretAsk extends SecretSlot {
    nodeId: string;
    projectId: string;
    launchName: string;
    label: string;
    reason: string;
    placeholder?: string;
}

/* What a person's Save does besides closing the card: the store and the launch, which the daemon wires. */
interface SecretSink {
    has(projectId: string, slot: SecretSlot): Promise<boolean>;
    /* Keeps the value and binds the variable on the launch; throws when it could not, and the card stays. */
    save(projectId: string, slot: SecretSlot, value: string): Promise<void>;
}

/* Holds the asking chat at `needs-you` while its card stands, the way a question of its CLI does. */
export interface SecretChats {
    hold(nodeId: string, key: string): void;
    release(nodeId: string, key: string): void;
}

interface SecretRequestsOptions {
    sink: SecretSink;
    chats: SecretChats;
    publish: (requests: SecretRequest[]) => void;
    now?: () => number;
    timers?: Timers;
    waitMs?: number;
    cardMs?: number;
}

interface Pending {
    request: SecretRequest;
    waiters: Set<(outcome: SecretOutcome) => void>;
    cancelExpiry: () => void;
}

function keyOf(nodeId: string, projectId: string, slot: SecretSlot): string {
    return JSON.stringify([nodeId, projectId, slot.launchId, slot.variable]);
}

/*
 * The cards in which an agent asks a person for a secret. One card per chat, launch and variable, so
 * an agent that asks again joins the card that stands. It goes to every client; whoever answers first
 * settles it. The value goes straight from the answer to the sink and is never kept here, never
 * published and never part of an outcome. An outcome the call that waited missed reaches the agent
 * on its next ask for the same variable, once.
 */
export class SecretRequests {
    private readonly sink: SecretSink;
    private readonly chats: SecretChats;
    private readonly publishList: (requests: SecretRequest[]) => void;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly waitMs: number;
    private readonly cardMs: number;
    private readonly pending = new Map<string, Pending>();
    private readonly settled = new Map<string, { requestId: string; outcome: SecretOutcome }>();

    constructor(options: SecretRequestsOptions) {
        this.sink = options.sink;
        this.chats = options.chats;
        this.publishList = options.publish;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.waitMs = options.waitMs ?? SECRET_WAIT_MS;
        this.cardMs = options.cardMs ?? SECRET_CARD_MS;
    }

    /* Raises the card, or joins the one that stands, and holds for the answer for `waitMs`, or the default hold. */
    async ask(ask: SecretAsk, waitMs: number = this.waitMs): Promise<{ requestId: string; outcome: SecretOutcome }> {
        const key = keyOf(ask.nodeId, ask.projectId, ask);
        const settled = this.settled.get(key);
        if (settled && !this.pending.has(key)) {
            this.settled.delete(key);
            return settled;
        }
        const pending = await this.raise(key, ask);
        return new Promise((resolve) => {
            const done = (outcome: SecretOutcome): void => {
                cancel();
                pending.waiters.delete(done);
                resolve({ requestId: pending.request.requestId, outcome });
            };
            const cancel = this.timers.set(() => {
                pending.waiters.delete(done);
                resolve({ requestId: pending.request.requestId, outcome: 'waiting' });
            }, waitMs);
            pending.waiters.add(done);
        });
    }

    /* A person's Save. False when the card is gone already, which tells a second client it lost the race. */
    async save(requestId: string, value: string): Promise<boolean> {
        const found = this.find(requestId);
        if (!found) {
            return false;
        }
        const [key, pending] = found;
        const { projectId, launchId, variable } = pending.request;
        await this.sink.save(projectId, { launchId, variable }, value);
        // Another client may have declined while the value was written; the save still landed.
        this.settle(key, pending, 'saved');
        return true;
    }

    decline(requestId: string): boolean {
        const found = this.find(requestId);
        if (!found) {
            return false;
        }
        this.settle(found[0], found[1], 'declined');
        return true;
    }

    list(): SecretRequest[] {
        return [...this.pending.values()].map((pending) => pending.request).sort((left, right) => left.createdAt - right.createdAt);
    }

    /* A turn of the chat ended, however it went: what it asked is no longer asked by anyone. */
    turnEnded(nodeId: string): void {
        this.cancelOf(nodeId);
    }

    /* The chat stopped running or is gone. */
    forget(nodeId: string): void {
        this.cancelOf(nodeId);
        for (const key of [...this.settled.keys()]) {
            if ((JSON.parse(key) as string[])[0] === nodeId) {
                this.settled.delete(key);
            }
        }
    }

    private cancelOf(nodeId: string): void {
        const cancelled = [...this.pending.entries()].filter(([, pending]) => pending.request.nodeId === nodeId);
        for (const [key, pending] of cancelled) {
            this.close(key, pending);
            for (const waiter of [...pending.waiters]) {
                waiter('cancelled');
            }
        }
        if (cancelled.length > 0) {
            this.publish();
        }
    }

    private find(requestId: string): [string, Pending] | undefined {
        return [...this.pending.entries()].find(([, pending]) => pending.request.requestId === requestId);
    }

    /* The waiting call hears the outcome; with none waiting the agent's next ask does. */
    private settle(key: string, pending: Pending, outcome: SecretOutcome): void {
        if (this.pending.get(key) !== pending) {
            return;
        }
        this.close(key, pending);
        if (pending.waiters.size === 0) {
            this.settled.set(key, { requestId: pending.request.requestId, outcome });
        }
        for (const waiter of [...pending.waiters]) {
            waiter(outcome);
        }
        this.publish();
    }

    private async raise(key: string, ask: SecretAsk): Promise<Pending> {
        const standing = this.pending.get(key);
        if (standing) {
            standing.cancelExpiry();
            standing.request = { ...standing.request, label: ask.label, reason: ask.reason, expiresAt: this.now() + this.cardMs };
            standing.cancelExpiry = this.expireLater(key, standing);
            this.publish();
            return standing;
        }
        const replaces = await this.sink.has(ask.projectId, ask);
        // An ask for the same card may have raised it while the store answered.
        const raced = this.pending.get(key);
        if (raced) {
            return raced;
        }
        this.settled.delete(key);
        const now = this.now();
        const pending: Pending = {
            request: {
                requestId: randomUUID(),
                nodeId: ask.nodeId,
                projectId: ask.projectId,
                launchId: ask.launchId,
                launchName: ask.launchName,
                variable: ask.variable,
                label: ask.label,
                reason: ask.reason,
                ...(ask.placeholder === undefined ? {} : { placeholder: ask.placeholder }),
                replaces,
                createdAt: now,
                expiresAt: now + this.cardMs
            },
            waiters: new Set(),
            cancelExpiry: () => undefined
        };
        pending.cancelExpiry = this.expireLater(key, pending);
        this.pending.set(key, pending);
        this.chats.hold(ask.nodeId, holdKeyOf(pending.request.requestId));
        this.publish();
        return pending;
    }

    private expireLater(key: string, pending: Pending): () => void {
        return this.timers.set(() => this.settle(key, pending, 'timed-out'), this.cardMs);
    }

    private close(key: string, pending: Pending): void {
        pending.cancelExpiry();
        this.pending.delete(key);
        this.chats.release(pending.request.nodeId, holdKeyOf(pending.request.requestId));
    }

    private publish(): void {
        this.publishList(this.list());
    }
}

function holdKeyOf(requestId: string): string {
    return `secret:${requestId}`;
}
