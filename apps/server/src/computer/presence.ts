import type { AgentStatus, ComputerApproval } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { PresenceState } from './helper-protocol.ts';
import type { PresenceWords } from './overlay-words.ts';

export interface PresenceShow {
    state: PresenceState;
    label?: string;
    // Shown for a moment, then the session ends, the way `done` does.
    ends?: true;
}

export interface ComputerPresenceOptions {
    /* One presence request; it may fail, which is logged and changes nothing. */
    send: (show: PresenceShow) => Promise<void>;
    words: () => PresenceWords;
    /* Whether the chat or terminal still runs; one that went without a word is closed. */
    alive: (nodeId: string) => boolean;
    onHolder?: (nodeId: string | null) => void;
    onLine?: (waiting: readonly string[]) => void;
    log?: (message: string) => void;
}

const same = (a: PresenceShow | null, b: PresenceShow | null): boolean => a?.state === b?.state && a?.label === b?.label && a?.ends === b?.ends;

/* How a place in line ends: the Mac is the waiter's now, the session went without a word, or the waiter's own node went. */
export type LineOutcome = 'yours' | 'dropped' | 'gone';

interface Waiter {
    nodeId: string;
    settle: (outcome: LineOutcome) => void;
}

/*
 * Which agent holds the helper's session, who waits for it, and what the cursor shows between actions.
 * The first agent to take the Mac holds it until its turn ends, its node goes or the session ends; the
 * line gets it in the order it asked. Only the holder's status is shown. Sends go out one at a time,
 * only on a change and only the newest, and nothing waits for them.
 */
export class ComputerPresence {
    private readonly options: ComputerPresenceOptions;
    private holderId: string | null = null;
    private line: Waiter[] = [];
    private readonly statuses = new Map<string, AgentStatus>();
    private readonly inFlight = new Map<string, number>();
    private cards: ComputerApproval[] = [];
    private ending: PresenceShow | null = null;
    private sent: PresenceShow | null = null;
    private sending = false;

    constructor(options: ComputerPresenceOptions) {
        this.options = options;
    }

    get holder(): string | null {
        return this.holderId;
    }

    /* The agents waiting for the Mac, first in line first. */
    get waiting(): string[] {
        return this.line.map((waiter) => waiter.nodeId);
    }

    /* Whether this agent holds the Mac, taking it when nobody does. */
    take(nodeId: string): boolean {
        if (this.holderId === null && this.line.length === 0) {
            this.claim(nodeId);
        }
        return this.holderId === nodeId;
    }

    /* Joins the line for the Mac; the returned function leaves it again without an outcome. */
    wait(nodeId: string, settle: (outcome: LineOutcome) => void): () => void {
        const waiter: Waiter = { nodeId, settle };
        this.line.push(waiter);
        this.lineChanged();
        return () => {
            if (this.line.includes(waiter)) {
                this.line = this.line.filter((candidate) => candidate !== waiter);
                this.lineChanged();
            }
        };
    }

    /* A call of this agent is under way: whatever it waits for, the helper or a card, nothing else is shown for it meanwhile. */
    calling(nodeId: string): void {
        this.inFlight.set(nodeId, (this.inFlight.get(nodeId) ?? 0) + 1);
    }

    /* The call goes to the helper for an app; one that nobody held is this agent's from now on. */
    acting(nodeId: string): void {
        this.take(nodeId);
        // The helper shows the action itself, so whatever went before has to be said again after it.
        this.sent = null;
    }

    /* The call came back, however it went. */
    acted(nodeId: string): void {
        const left = (this.inFlight.get(nodeId) ?? 1) - 1;
        if (left > 0) {
            this.inFlight.set(nodeId, left);
        } else {
            this.inFlight.delete(nodeId);
        }
        if (nodeId === this.holderId) {
            this.flush();
        }
    }

    /* The cards that stand. Only the holder's shows; a card for an agent in line waits there with it. */
    approvals(cards: ComputerApproval[]): void {
        this.cards = cards;
        this.flush();
    }

    /* What a chat or terminal is doing, from its hooks or its chat events. */
    status(nodeId: string, status: AgentStatus): void {
        this.statuses.set(nodeId, status);
        if (nodeId !== this.holderId) {
            if (status === 'exited') {
                this.leaveLine(nodeId, 'gone');
            }
            return;
        }
        if (status === 'exited') {
            this.end({ state: 'end' });
        } else if (status === 'idle') {
            this.end({ state: 'done' });
        } else if (status === 'error') {
            this.end(this.failure());
        } else {
            this.flush();
        }
    }

    /* A chat's turn settled: finished, interrupted by the person, or failed. */
    turnEnded(nodeId: string, how: 'done' | 'aborted' | 'error'): void {
        this.statuses.set(nodeId, 'idle');
        if (nodeId === this.holderId) {
            this.end(how === 'done' ? { state: 'done' } : how === 'aborted' ? { state: 'end' } : this.failure());
        }
    }

    closed(nodeId: string): void {
        this.statuses.delete(nodeId);
        this.inFlight.delete(nodeId);
        this.leaveLine(nodeId, 'gone');
        if (nodeId === this.holderId) {
            this.end({ state: 'end' });
        }
    }

    /* The helper ended the session by itself after a quiet while; a holder whose call is still out keeps the Mac. */
    helperEnded(): void {
        if (this.holderId !== null && !this.inFlight.has(this.holderId)) {
            this.ending = null;
            this.sent = null;
            this.handOver();
        }
    }

    /* The session went without a word from an agent: the person stopped it, or computer use was turned off. Nobody takes it over. */
    drop(): void {
        this.ending = null;
        this.sent = null;
        this.setHolder(null);
        const line = this.line;
        this.line = [];
        if (line.length > 0) {
            this.lineChanged();
        }
        for (const waiter of line) {
            waiter.settle('dropped');
        }
    }

    private claim(nodeId: string): void {
        if (this.holderId === nodeId) {
            return;
        }
        this.ending = null;
        this.setHolder(nodeId);
    }

    private failure(): PresenceShow {
        return { state: 'error', label: this.options.words().agentError, ends: true };
    }

    private end(show: PresenceShow): void {
        this.ending = show;
        this.handOver();
        this.flush();
    }

    /* The holder lets go, and the first in line holds the Mac from this moment, so nobody who asked later gets there first. */
    private handOver(): void {
        const next = this.line[0];
        this.setHolder(next?.nodeId ?? null);
        if (next !== undefined) {
            this.leaveLine(next.nodeId, 'yours');
        }
    }

    private leaveLine(nodeId: string, outcome: LineOutcome): void {
        const leaving = this.line.filter((waiter) => waiter.nodeId === nodeId);
        if (leaving.length === 0) {
            return;
        }
        this.line = this.line.filter((waiter) => waiter.nodeId !== nodeId);
        this.lineChanged();
        for (const waiter of leaving) {
            waiter.settle(outcome);
        }
    }

    private lineChanged(): void {
        this.options.onLine?.(this.waiting);
    }

    private setHolder(nodeId: string | null): void {
        if (this.holderId !== nodeId) {
            this.holderId = nodeId;
            this.options.onHolder?.(nodeId);
        }
    }

    private desired(): PresenceShow | null {
        if (this.ending !== null) {
            return this.ending;
        }
        const holder = this.holderId;
        if (holder === null) {
            return null;
        }
        const card = this.cards.find((candidate) => candidate.nodeId === holder);
        if (card !== undefined) {
            return { state: 'permission', label: this.options.words().permission(card.app.name) };
        }
        if (this.inFlight.has(holder)) {
            return null;
        }
        return { state: this.statuses.get(holder) === 'needs-you' ? 'waiting' : 'think' };
    }

    private flush(): void {
        if (!this.sending) {
            void this.drain();
        }
    }

    private async drain(): Promise<void> {
        this.sending = true;
        try {
            for (;;) {
                if (this.holderId !== null && !this.options.alive(this.holderId)) {
                    this.closed(this.holderId);
                }
                const want = this.desired();
                if (want === this.ending) {
                    this.ending = null;
                }
                if (want === null || same(want, this.sent)) {
                    return;
                }
                this.sent = want;
                try {
                    await this.options.send(want);
                } catch (error) {
                    (this.options.log ?? console.warn)(`Showing ${want.state} at the computer use cursor failed: ${errorText(error)}`);
                }
            }
        } finally {
            this.sending = false;
        }
    }
}
