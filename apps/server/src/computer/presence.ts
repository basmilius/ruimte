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
    log?: (message: string) => void;
}

const same = (a: PresenceShow | null, b: PresenceShow | null): boolean => a?.state === b?.state && a?.label === b?.label && a?.ends === b?.ends;

/*
 * What the cursor shows between actions, driven by the one agent that holds the helper's session:
 * the one whose app call reached the helper last. Everybody else's status is noted and never shown.
 * Sends go out one at a time, only on a change and only the newest, and nothing waits for them.
 */
export class ComputerPresence {
    private readonly options: ComputerPresenceOptions;
    private holderId: string | null = null;
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

    /* A call of this agent is under way: whatever it waits for, the helper or a card, nothing else is shown for it meanwhile. */
    calling(nodeId: string): void {
        this.inFlight.set(nodeId, (this.inFlight.get(nodeId) ?? 0) + 1);
    }

    /* The call goes to the helper for an app, which makes this agent the one that holds the session. */
    acting(nodeId: string): void {
        this.claim(nodeId);
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

    /* The cards that stand. A card claims a session nobody holds, so the first ask of all shows too. */
    approvals(cards: ComputerApproval[]): void {
        this.cards = cards;
        const first = cards[0];
        if (this.holderId === null && first !== undefined) {
            this.claim(first.nodeId);
        }
        this.flush();
    }

    /* What a chat or terminal is doing, from its hooks or its chat events. */
    status(nodeId: string, status: AgentStatus): void {
        this.statuses.set(nodeId, status);
        if (nodeId !== this.holderId) {
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
        if (nodeId === this.holderId) {
            this.end({ state: 'end' });
        }
    }

    /* The session went without a word from an agent: the person stopped it, or computer use was turned off. */
    drop(): void {
        this.ending = null;
        this.sent = null;
        this.setHolder(null);
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
        this.setHolder(null);
        this.flush();
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
