import { randomUUID } from 'node:crypto';
import type { ProjectProposal } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { realTimers, type Timers } from '../timers.ts';
import type { SessionEvent, SessionSink } from '../wire.ts';

/* A card is a suggestion to think over, so it outlasts the turn that raised it; a day without a new ask takes it down. */
export const PROPOSAL_CARD_MS = 24 * 60 * 60_000;

type ProposalOutcome = 'declined' | 'waiting';

export interface ProposalAsk {
    chatId: string;
    name: string;
    folder?: string;
    reason: string;
}

export interface ProposalAnswer {
    proposalId: string;
    outcome: ProposalOutcome;
}

/* Holds the suggesting chat at `needs-you` while its card stands, the way a question of its CLI does. */
interface ProposalChats {
    hold(chatId: string, key: string): void;
    release(chatId: string, key: string): void;
}

interface ProjectProposalsOptions {
    chats: ProposalChats;
    now?: () => number;
    timers?: Timers;
    cardMs?: number;
}

interface Pending {
    proposal: ProjectProposal;
    cancelExpiry: () => void;
}

function holdKeyOf(proposalId: string): string {
    return `project-proposal:${proposalId}`;
}

/*
 * The cards in which an agent in Chats suggests that its chat becomes a project, one per chat: a
 * second suggestion joins the card that stands. Whoever answers first settles it, and nothing is made
 * here; a move of the chat takes the card down. A suggestion never waits for the person, since a turn
 * held open would block the very move the card offers, so a decline reaches the agent with its next
 * suggestion, once.
 */
export class ProjectProposals {
    private readonly chats: ProposalChats;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly cardMs: number;
    private readonly sinks = new ClientSinks();
    private readonly pending = new Map<string, Pending>();
    private readonly unheard = new Map<string, ProposalAnswer>();

    constructor(options: ProjectProposalsOptions) {
        this.chats = options.chats;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.cardMs = options.cardMs ?? PROPOSAL_CARD_MS;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Raises the card, or joins the one that stands, and answers `waiting` at once; an answer nobody heard yet comes instead, once. */
    ask(ask: ProposalAsk): ProposalAnswer {
        const told = this.unheard.get(ask.chatId);
        if (told !== undefined && !this.pending.has(ask.chatId)) {
            this.unheard.delete(ask.chatId);
            return told;
        }
        return { proposalId: this.raise(ask).proposal.proposalId, outcome: 'waiting' };
    }

    list(): ProjectProposal[] {
        return [...this.pending.values()].map((pending) => pending.proposal).sort((a, b) => a.createdAt - b.createdAt);
    }

    /* Whether this chat has a card up, which is what holds it at `needs-you`. */
    stands(chatId: string): boolean {
        return this.pending.has(chatId);
    }

    /*
     * Lets go of the hold of the card that stands, since a held chat does not relocate. The returned function
     * puts it back for a move that did not happen, as long as the same card stands; null when no card stands.
     */
    pauseHold(chatId: string): (() => void) | null {
        const pending = this.pending.get(chatId);
        if (pending === undefined) {
            return null;
        }
        const key = holdKeyOf(pending.proposal.proposalId);
        this.chats.release(chatId, key);
        return () => {
            if (this.pending.get(chatId) === pending) {
                this.chats.hold(chatId, key);
            }
        };
    }

    /* A person's no. False when the card is gone already, which tells a second client it lost the race. */
    decline(proposalId: string): boolean {
        const found = this.find(proposalId);
        if (found === undefined) {
            return false;
        }
        this.settle(found, { proposalId, outcome: 'declined' });
        return true;
    }

    /* The chat left Chats for a project, however the person got there: it can suggest nothing more, so nothing is left to tell it. */
    moved(chatId: string): void {
        this.forget(chatId);
    }

    /* The chat stopped running or is gone: nobody is left to hear an answer. */
    forget(chatId: string): void {
        const pending = this.pending.get(chatId);
        if (pending !== undefined) {
            this.settle(pending, null);
        }
        this.unheard.delete(chatId);
    }

    observe(event: SessionEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chat } = event.payload;
        if ((chat.type === 'info' || chat.type === 'reset') && chat.info.status === 'exited') {
            this.forget(chatId);
        }
    }

    private find(proposalId: string): Pending | undefined {
        return [...this.pending.values()].find((pending) => pending.proposal.proposalId === proposalId);
    }

    private raise(ask: ProposalAsk): Pending {
        const standing = this.pending.get(ask.chatId);
        const now = this.now();
        const words = { name: ask.name, ...(ask.folder === undefined ? {} : { folder: ask.folder }), reason: ask.reason };
        const expiresAt = now + this.cardMs;
        if (standing !== undefined) {
            standing.cancelExpiry();
            const { proposalId, chatId, createdAt } = standing.proposal;
            standing.proposal = { proposalId, chatId, ...words, createdAt, expiresAt };
            standing.cancelExpiry = this.expireLater(standing);
            this.publish();
            return standing;
        }
        this.unheard.delete(ask.chatId);
        const pending: Pending = {
            proposal: { proposalId: randomUUID(), chatId: ask.chatId, ...words, createdAt: now, expiresAt },
            cancelExpiry: () => undefined
        };
        pending.cancelExpiry = this.expireLater(pending);
        this.pending.set(ask.chatId, pending);
        this.chats.hold(ask.chatId, holdKeyOf(pending.proposal.proposalId));
        this.publish();
        return pending;
    }

    private expireLater(pending: Pending): () => void {
        return this.timers.set(() => this.settle(pending, null), this.cardMs);
    }

    /* The agent hears the answer with its next suggestion; a card that only lapsed or whose chat is gone or moved has none. */
    private settle(pending: Pending, answer: ProposalAnswer | null): void {
        const { chatId, proposalId } = pending.proposal;
        if (this.pending.get(chatId) !== pending) {
            return;
        }
        pending.cancelExpiry();
        this.pending.delete(chatId);
        this.chats.release(chatId, holdKeyOf(proposalId));
        if (answer !== null) {
            this.unheard.set(chatId, answer);
        }
        this.publish();
    }

    private publish(): void {
        this.sinks.emit({ event: 'chat.proposals', payload: { proposals: this.list() } });
    }
}
