import { randomUUID } from 'node:crypto';
import type { AgentStatus, ComputerApproval, ComputerApprovalChoice, ComputerThisTimeGrant } from '@ruimte/contracts';

/*
 * How long a verb holds its call while the card is up. Codex ends a shell command after 10 s unless
 * the model asked for longer, the shortest default of the agent CLIs, and an approved call still has
 * to run its action inside that. Past this the agent hears `awaiting-approval` and calls again.
 */
export const APPROVAL_WAIT_MS = 6_000;

/* How long a card stands after the agent last asked: long enough to answer after a coffee, short enough that a card for an agent that gave up goes. */
export const CARD_MS = 10 * 60_000;

export interface AppRef {
    name: string;
    bundleId: string;
}

/* Where the agent that asks runs, which is what the card names besides the app. */
export interface CallerInfo {
    surface: 'chat' | 'terminal';
    nodeTitle: string | null;
    projectId: string | null;
    projectName: string | null;
}

export interface ApprovalAsk {
    callerId: string;
    /* Which run of that chat or terminal asks; a card stands only while it is the one running. */
    run: string;
    app: AppRef;
    command: string;
    caller: CallerInfo;
}

export type ApprovalOutcome = 'granted' | 'declined' | 'waiting';

export interface GrantBook {
    alwaysAllowed(bundleId: string): boolean;
    allowAlways(bundleId: string, name: string): Promise<void>;
}

export interface Timers {
    set(run: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
    set: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

interface Pending {
    request: ComputerApproval;
    run: string;
    waiters: Set<(outcome: ApprovalOutcome) => void>;
    cancelExpiry: () => void;
}

export interface ComputerApprovalsOptions {
    grants: GrantBook;
    /* The run a chat or terminal is on now, or null when it runs no more. */
    runOf: (callerId: string) => string | null;
    publish: (approvals: ComputerApproval[]) => void;
    /* A grant for always or for this time came or went; `thisTimeGrants` has the list after it. */
    grantsChanged?: () => void;
    now?: () => number;
    timers?: Timers;
    waitMs?: number;
    cardMs?: number;
}

const keyOf = (callerId: string, bundleId: string): string => `${callerId}\n${bundleId}`;

/* The statuses of an agent in the middle of a turn: waiting on the person is still that turn. */
const inTurn = (status: AgentStatus | undefined): boolean => status === 'running' || status === 'needs-you';

/*
 * Which apps each agent may operate, and the cards that ask a person about the rest. A card is one
 * per agent and app and goes to every client; whoever answers first settles it. A grant for this
 * time lives in memory and ends with the turn of the agent it was given to, or with the run of its
 * chat or terminal; a grant for always is the store's. A no reaches the agent once: the call that
 * waits hears it, or else the next.
 */
export class ComputerApprovals {
    private readonly grants: GrantBook;
    private readonly runOf: (callerId: string) => string | null;
    private readonly publishList: (approvals: ComputerApproval[]) => void;
    private readonly grantsChanged: () => void;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly waitMs: number;
    private readonly cardMs: number;
    private readonly pending = new Map<string, Pending>();
    private readonly thisTime = new Map<string, { run: string; apps: Map<string, ComputerThisTimeGrant> }>();
    private readonly declined = new Map<string, string>();
    private readonly statuses = new Map<string, AgentStatus>();

    constructor(options: ComputerApprovalsOptions) {
        this.grants = options.grants;
        this.runOf = options.runOf;
        this.publishList = options.publish;
        this.grantsChanged = options.grantsChanged ?? (() => undefined);
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.waitMs = options.waitMs ?? APPROVAL_WAIT_MS;
        this.cardMs = options.cardMs ?? CARD_MS;
    }

    /* Whether this run of the caller may operate the app without asking. */
    allowed(callerId: string, run: string, bundleId: string): boolean {
        if (this.grants.alwaysAllowed(bundleId)) {
            return true;
        }
        const granted = this.thisTime.get(callerId);
        return granted !== undefined && granted.run === run && granted.apps.has(bundleId);
    }

    /* How a caller stands with an app without asking anything: what `apps` prints per app. */
    standing(callerId: string, run: string, bundleId: string): 'always' | 'this-time' | 'ask' {
        if (this.grants.alwaysAllowed(bundleId)) {
            return 'always';
        }
        return this.allowed(callerId, run, bundleId) ? 'this-time' : 'ask';
    }

    /* Raises the card, or joins the one that stands, and holds for a while for the answer. */
    async ask(ask: ApprovalAsk): Promise<ApprovalOutcome> {
        const { callerId, run, app } = ask;
        if (this.allowed(callerId, run, app.bundleId)) {
            return 'granted';
        }
        const key = keyOf(callerId, app.bundleId);
        if (this.declined.get(key) === run) {
            this.declined.delete(key);
            return 'declined';
        }
        const pending = this.raise(key, ask);
        return new Promise<ApprovalOutcome>((settle) => {
            const cancel = this.timers.set(() => {
                pending.waiters.delete(done);
                settle('waiting');
            }, this.waitMs);
            const done = (outcome: ApprovalOutcome): void => {
                cancel();
                settle(outcome);
            };
            pending.waiters.add(done);
        });
    }

    /* A person's answer. False when the card is gone already, which tells a second client it lost the race. */
    async answer(requestId: string, choice: ComputerApprovalChoice): Promise<boolean> {
        const entry = [...this.pending.entries()].find(([, pending]) => pending.request.requestId === requestId);
        if (!entry) {
            return false;
        }
        const [key, pending] = entry;
        const { nodeId, nodeTitle, projectName, app } = pending.request;
        this.close(key);
        if (choice === 'always') {
            await this.grants.allowAlways(app.bundleId, app.name);
            this.grantsChanged();
        } else if (choice === 'once') {
            const granted = this.thisTime.get(nodeId);
            const apps = granted?.run === pending.run ? granted.apps : new Map<string, ComputerThisTimeGrant>();
            apps.set(app.bundleId, { name: app.name, bundleId: app.bundleId, at: this.now(), nodeId, nodeTitle, projectName });
            this.thisTime.set(nodeId, { run: pending.run, apps });
            this.grantsChanged();
        } else if (pending.waiters.size === 0) {
            this.declined.set(key, pending.run);
        }
        const outcome = choice === 'deny' ? 'declined' : 'granted';
        for (const waiter of pending.waiters) {
            waiter(outcome);
        }
        this.publish();
        return true;
    }

    /* The cards that stand, without those of a chat or terminal that stopped running since. */
    list(): ComputerApproval[] {
        for (const [key, pending] of this.pending) {
            if (this.runOf(pending.request.nodeId) !== pending.run) {
                this.close(key);
            }
        }
        return [...this.pending.values()].map((pending) => pending.request).sort((a, b) => a.createdAt - b.createdAt);
    }

    /* What agents may operate for this time, without the grants of a run that ended since; oldest first. */
    thisTimeGrants(): ComputerThisTimeGrant[] {
        return [...this.thisTime]
            .filter(([nodeId, granted]) => this.runOf(nodeId) === granted.run)
            .flatMap(([, granted]) => [...granted.apps.values()])
            .sort((a, b) => a.at - b.at);
    }

    /* A person takes back one app for this time, from one agent or from every agent that holds it. */
    revokeThisTime(bundleId: string, nodeId?: string): boolean {
        let removed = false;
        for (const [holder, granted] of this.thisTime) {
            if ((nodeId === undefined || holder === nodeId) && granted.apps.delete(bundleId)) {
                removed = true;
                if (granted.apps.size === 0) {
                    this.thisTime.delete(holder);
                }
            }
        }
        if (removed) {
            this.grantsChanged();
        }
        return removed;
    }

    /* Every grant for this time, after a person stopped a session: going on asks again. */
    dropThisTime(): void {
        if (this.thisTime.size > 0) {
            this.thisTime.clear();
            this.grantsChanged();
        }
    }

    /* What a chat or terminal is doing. A turn that ends takes back what was allowed this time; one allowed between turns lasts through the next. */
    agentStatus(nodeId: string, status: AgentStatus): void {
        const before = this.statuses.get(nodeId);
        this.statuses.set(nodeId, status);
        if (inTurn(before) && !inTurn(status)) {
            this.endThisTime(nodeId);
        }
    }

    /* A chat's turn settled, however it went. */
    turnEnded(nodeId: string): void {
        this.agentStatus(nodeId, 'idle');
        this.endThisTime(nodeId);
    }

    /* The agent of a chat or terminal is gone: its cards go at once, instead of when they would have expired. */
    forget(nodeId: string): void {
        const cards = [...this.pending.entries()].filter(([, pending]) => pending.request.nodeId === nodeId);
        for (const [key] of cards) {
            this.close(key);
        }
        for (const waiter of cards.flatMap(([, pending]) => [...pending.waiters])) {
            waiter('declined');
        }
        for (const key of [...this.declined.keys()].filter((candidate) => candidate.startsWith(`${nodeId}\n`))) {
            this.declined.delete(key);
        }
        this.endThisTime(nodeId);
        this.statuses.delete(nodeId);
        this.publish();
    }

    /* Takes every card down, when a person turns computer use off; nothing waits for an answer after that. */
    dropAll(): void {
        const all = [...this.pending.values()];
        for (const key of [...this.pending.keys()]) {
            this.close(key);
        }
        for (const waiter of all.flatMap((pending) => [...pending.waiters])) {
            waiter('declined');
        }
        this.publish();
    }

    private endThisTime(nodeId: string): void {
        if (this.thisTime.delete(nodeId)) {
            this.grantsChanged();
        }
    }

    private raise(key: string, ask: ApprovalAsk): Pending {
        const now = this.now();
        const standing = this.pending.get(key);
        if (standing && standing.run === ask.run) {
            standing.cancelExpiry();
            standing.request = { ...standing.request, expiresAt: now + this.cardMs };
            standing.cancelExpiry = this.expireLater(key);
            this.publish();
            return standing;
        }
        if (standing) {
            this.close(key);
        }
        const pending: Pending = {
            request: {
                requestId: randomUUID(),
                nodeId: ask.callerId,
                surface: ask.caller.surface,
                nodeTitle: ask.caller.nodeTitle,
                projectId: ask.caller.projectId,
                projectName: ask.caller.projectName,
                app: { name: ask.app.name, bundleId: ask.app.bundleId },
                command: ask.command,
                createdAt: now,
                expiresAt: now + this.cardMs
            },
            run: ask.run,
            waiters: new Set(),
            cancelExpiry: this.expireLater(key)
        };
        this.pending.set(key, pending);
        this.publish();
        return pending;
    }

    private expireLater(key: string): () => void {
        return this.timers.set(() => {
            const pending = this.pending.get(key);
            if (!pending) {
                return;
            }
            this.close(key);
            for (const waiter of pending.waiters) {
                waiter('waiting');
            }
            this.publish();
        }, this.cardMs);
    }

    private close(key: string): void {
        this.pending.get(key)?.cancelExpiry();
        this.pending.delete(key);
    }

    private publish(): void {
        this.publishList(this.list());
    }
}
