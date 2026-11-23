import { randomUUID } from 'node:crypto';
import { CodedError } from '@adecore/agents';
import type { SecretField, SecretRequest } from '@ruimte/contracts';
import { realTimers, type Timers } from '../timers.ts';

/*
 * How long a tool holds its call while the card is up, unless the agent asks for longer with `wait`.
 * Some agent CLIs end a shell command after 10 s unless the model asked for more; past this the agent
 * hears `waiting`, and a person's answer wakes its chat.
 */
export const SECRET_WAIT_MS = 6_000;

/* How long a card stands after the agent last asked: long enough to go and find a key, short enough that a card for an agent that gave up goes. */
export const SECRET_CARD_MS = 15 * 60_000;

export type SecretOutcome = 'saved' | 'declined' | 'cancelled' | 'timed-out' | 'waiting';

/* Where a saved value goes: a variable of a launch, or private files the asking agent's commands read. */
export type SecretTarget =
    | { delivery: 'launch'; launchId: string; launchName: string; variable: string }
    | { delivery: 'file'; fields?: readonly SecretField[] };

export interface SecretAsk {
    nodeId: string;
    projectId: string;
    target: SecretTarget;
    label: string;
    reason: string;
    placeholder?: string;
    url?: string;
}

/* A file a saved file card wrote: the field it holds, null for a card with one value. */
export interface SecretFile {
    field: string | null;
    path: string;
}

export interface SecretAnswer {
    requestId: string;
    outcome: SecretOutcome;
    files: SecretFile[];
}

/* What a person typed: one value, or one per field of a card with `fields`. */
export type SecretValues = { value: string } | { values: Readonly<Record<string, string>> };

/* What a person's Save does besides closing the card: the store, the launch or the files, which the daemon wires. */
interface SecretSink {
    has(projectId: string, target: SecretTarget): Promise<boolean>;
    /* Keeps the values where the target says; throws when it could not, and the card stays. */
    save(projectId: string, target: SecretTarget, values: readonly { field: string | null; value: string }[]): Promise<SecretFile[]>;
}

/* What a card does to the chat that raised it. */
export interface SecretChats {
    /* Holds the chat at `needs-you` while its card stands, the way a question of its CLI does. */
    hold(nodeId: string, key: string): void;
    release(nodeId: string, key: string): void;
    /* A person's answer that no call waited for, which wakes the chat once. */
    answered(nodeId: string, wake: { text: string; label: string }): void;
    /* What became of a card, as a line in the chat's thread. */
    record(nodeId: string, record: { label: string; outcome: 'saved' | 'declined' | 'timed-out'; fields?: string[] }): void;
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
    target: SecretTarget;
    waiters: Set<(answer: Omit<SecretAnswer, 'requestId'>) => void>;
    cancelExpiry: () => void;
}

function keyOf(ask: Pick<SecretAsk, 'nodeId' | 'projectId' | 'target' | 'label'>): string {
    const { target } = ask;

    return target.delivery === 'launch'
        ? JSON.stringify([ask.nodeId, ask.projectId, 'launch', target.launchId, target.variable])
        : JSON.stringify([ask.nodeId, ask.projectId, 'file', ask.label, (target.fields ?? []).map((field) => field.name)]);
}

/* The values of an answer in the order of the card's fields, or null when they are not the ones it asks for. */
function valuesFor(target: SecretTarget, answer: SecretValues): { field: string | null; value: string }[] | null {
    const fields = target.delivery === 'file' ? target.fields : undefined;

    if (fields === undefined) {
        return 'value' in answer && answer.value !== '' ? [{ field: null, value: answer.value }] : null;
    }

    if (!('values' in answer) || Object.keys(answer.values).length !== fields.length) {
        return null;
    }

    const values = fields.map((field) => ({ field: field.name, value: answer.values[field.name] ?? '' }));

    return values.every((entry) => entry.value !== '') ? values : null;
}

/* The lines that tell the agent where a saved file card put its values. */
export function fileLines(files: readonly SecretFile[]): string[] {
    return files.map((file) => (file.field === null ? file.path : `${file.field}: ${file.path}`));
}

/* What the agent hears about a person's answer that no call waited for. */
export function answerWake(
    request: Pick<SecretRequest, 'label' | 'launchName' | 'variable'>,
    outcome: 'saved' | 'declined',
    files: readonly SecretFile[]
): { text: string; label: string } {
    if (outcome === 'declined') {
        return { text: `Declined: ${request.label}. ${DECLINED_NOTE}`, label: 'Secret: declined' };
    }

    if (files.length === 0) {
        return { text: `Saved: ${request.label}, as ${request.variable} of the launch ${request.launchName}. Its next start gets it.`, label: 'Secret: saved' };
    }

    return { text: [`Saved: ${request.label}. ${FILE_NOTE}`, ...fileLines(files)].join('\n'), label: 'Secret: saved' };
}

/* What a decline asks of the agent, in a wake and in a tool's answer alike. */
export const DECLINED_NOTE = "Don't ask for it in the chat or another way; say what is blocked and go on without it.";

export const FILE_NOTE = 'Read each file only inside the command that needs it, such as "$(cat <file>)"; never print it. The files go after 24 hours.';

/*
 * The cards in which an agent asks a person for a secret. One card per chat and launch variable, or per
 * chat and label for files, so an agent that asks again joins the card that stands. It goes to every
 * client; whoever answers first settles it. A card outlives the turn that raised it: a person's answer
 * goes to the call that waits for it, or else wakes the chat once. The value goes straight from the
 * answer to the sink and is never kept here, never published and never part of an outcome. A card
 * that times out while no call waits reaches the agent on its next ask for the same card, once.
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
    private readonly settled = new Map<string, SecretAnswer>();

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
    async ask(ask: SecretAsk, waitMs: number = this.waitMs): Promise<SecretAnswer> {
        const key = keyOf(ask);
        const settled = this.settled.get(key);

        if (settled && !this.pending.has(key)) {
            this.settled.delete(key);

            return settled;
        }

        const pending = await this.raise(key, ask);

        return new Promise((resolve) => {
            const { requestId } = pending.request;

            const done = (answer: Omit<SecretAnswer, 'requestId'>): void => {
                cancel();
                pending.waiters.delete(done);
                resolve({ requestId, ...answer });
            };

            const cancel = this.timers.set(() => {
                pending.waiters.delete(done);
                resolve({ requestId, outcome: 'waiting', files: [] });
            }, waitMs);

            pending.waiters.add(done);
        });
    }

    /*
     * A person's Save. False when the card is gone already, which tells a second client it lost the race;
     * throws when the values are not the ones the card asks for.
     */
    async save(requestId: string, answer: SecretValues): Promise<boolean> {
        const found = this.find(requestId);

        if (!found) {
            return false;
        }

        const [key, pending] = found;
        const values = valuesFor(pending.target, answer);

        if (values === null) {
            throw new CodedError('secret-values', 'This card asks for other values');
        }

        const files = await this.sink.save(pending.request.projectId, pending.target, values);

        // Another client may have declined while the value was written; the save still landed.
        this.settle(key, pending, 'saved', files);

        return true;
    }

    decline(requestId: string): boolean {
        const found = this.find(requestId);

        if (!found) {
            return false;
        }

        this.settle(found[0], found[1], 'declined', []);

        return true;
    }

    list(): SecretRequest[] {
        return [...this.pending.values()].map((pending) => pending.request).sort((left, right) => left.createdAt - right.createdAt);
    }

    /* The chat stopped or went: what it asked is no longer asked by anyone. */
    forget(nodeId: string): void {
        const cancelled = [...this.pending.entries()].filter(([, pending]) => pending.request.nodeId === nodeId);

        for (const [key, pending] of cancelled) {
            this.close(key, pending);

            for (const waiter of [...pending.waiters]) {
                waiter({ outcome: 'cancelled', files: [] });
            }
        }

        for (const key of [...this.settled.keys()]) {
            if ((JSON.parse(key) as string[])[0] === nodeId) {
                this.settled.delete(key);
            }
        }

        if (cancelled.length > 0) {
            this.publish();
        }
    }

    private find(requestId: string): [string, Pending] | undefined {
        return [...this.pending.entries()].find(([, pending]) => pending.request.requestId === requestId);
    }

    private settle(key: string, pending: Pending, outcome: 'saved' | 'declined' | 'timed-out', files: SecretFile[]): void {
        if (this.pending.get(key) !== pending) {
            return;
        }

        const { request } = pending;

        this.close(key, pending);
        this.chats.record(request.nodeId, {
            label: request.label,
            outcome,
            ...(request.fields === undefined ? {} : { fields: request.fields.map((field) => field.label) })
        });

        if (pending.waiters.size > 0) {
            for (const waiter of [...pending.waiters]) {
                waiter({ outcome, files });
            }
        } else if (outcome === 'timed-out') {
            this.settled.set(key, { requestId: request.requestId, outcome, files });
        } else {
            this.chats.answered(request.nodeId, answerWake(request, outcome, files));
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

        const replaces = await this.sink.has(ask.projectId, ask.target);
        // An ask for the same card may have raised it while the store answered.
        const raced = this.pending.get(key);

        if (raced) {
            return raced;
        }

        this.settled.delete(key);

        const now = this.now();
        const { target } = ask;
        const pending: Pending = {
            request: {
                requestId: randomUUID(),
                nodeId: ask.nodeId,
                projectId: ask.projectId,
                delivery: target.delivery,
                ...(target.delivery === 'launch'
                    ? { launchId: target.launchId, launchName: target.launchName, variable: target.variable }
                    : target.fields === undefined
                      ? {}
                      : { fields: [...target.fields] }),
                label: ask.label,
                reason: ask.reason,
                ...(ask.placeholder === undefined ? {} : { placeholder: ask.placeholder }),
                ...(ask.url === undefined ? {} : { url: ask.url }),
                replaces,
                createdAt: now,
                expiresAt: now + this.cardMs
            },
            target,
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
        return this.timers.set(() => this.settle(key, pending, 'timed-out', []), this.cardMs);
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
