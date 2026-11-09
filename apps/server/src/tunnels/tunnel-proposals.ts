import { randomUUID } from 'node:crypto';
import type { TunnelOrigin, TunnelProposal, TunnelProposalAction, TunnelRowKind } from '@ruimte/contracts';
import { realTimers, type Timers } from '../timers.ts';
import type { SessionEvent } from '../wire.ts';
import { TunnelConfigError } from './tunnel-config.ts';
import type { AddInput, UpdateInput } from './tunnel-service.ts';
import type { StoredRow } from './tunnel-store.ts';

/* A card about the machine's public addresses is decided on now; an agent that still wants it asks again. */
export const TUNNEL_PROPOSAL_CARD_MS = 60 * 60_000;

const MAX_CARDS_PER_CHAT = 10;
const MAX_CARDS = 100;
const MAX_OUTCOMES_PER_CHAT = 10;

export type TunnelProposalOutcome = 'waiting' | 'confirmed' | 'declined' | 'stale' | 'expired';

/* What a confirm changes: the very input the person's own request in Settings sends. */
export type TunnelChange =
    | { action: 'add'; input: AddInput }
    | { action: Exclude<TunnelProposalAction, 'add' | 'remove'>; rowId: string; change: UpdateInput }
    | { action: 'remove'; rowId: string };

export interface TunnelProposalAsk {
    chatId: string;
    change: TunnelChange;
    kind: TunnelRowKind;
    hostname: string;
    /* The port and origin the hostname points at once confirmed, as the card says it. */
    port: number | null;
    origin?: TunnelOrigin;
    reason?: string;
}

export interface TunnelProposalAnswer {
    proposalId: string;
    outcome: TunnelProposalOutcome;
}

export interface TunnelProposalSettled extends TunnelProposalAnswer {
    action: TunnelProposalAction;
    hostname: string;
}

/* The tunnel service as a card reaches it: the checks of the person's own changes, the rows as meant, and the changes themselves. */
export interface ProposalTunnels {
    checkAdd(input: AddInput): string;
    checkChange(id: string, change: UpdateInput | 'remove'): void;
    rowsAsMeant(): readonly StoredRow[];
    add(input: AddInput): Promise<unknown>;
    update(id: string, change: UpdateInput): Promise<unknown>;
    remove(id: string): Promise<unknown>;
}

/* Holds the suggesting chat at `needs-you` while its card stands, the way a question of its CLI does. */
interface ProposalChats {
    hold(chatId: string, key: string): void;
    release(chatId: string, key: string): void;
}

interface TunnelProposalsOptions {
    tunnels: ProposalTunnels;
    chats: ProposalChats;
    publish(proposals: TunnelProposal[]): void;
    /* Owes the chat a turn with a person's confirm or decline (`deliver-answer`); absent in a test that only reads outcomes. */
    answered?(chatId: string, wake: { text: string; label: string }): void;
    now?: () => number;
    timers?: Timers;
    cardMs?: number;
}

interface Pending {
    proposal: Omit<TunnelProposal, 'stale'>;
    change: TunnelChange;
    /* The row as it was meant when the agent asked; a card stands for that row only. */
    seen: string | null;
    confirming: boolean;
    cancelExpiry: () => void;
}

/* The change as the agent asked it, in the words of the card. */
function changeWords(proposal: Pick<TunnelProposal, 'action' | 'hostname' | 'port' | 'origin'>): string {
    const { hostname } = proposal;
    const target = `port ${proposal.port ?? '-'}${proposal.origin?.https === true ? ' over HTTPS' : ''}`;

    switch (proposal.action) {
        case 'add':
            return `add ${hostname} → ${target}`;
        case 'edit':
            return `point ${hostname} at ${target}`;
        case 'on':
            return `turn on ${hostname}`;
        case 'off':
            return `turn off ${hostname}`;
        case 'remove':
            return `remove ${hostname}`;
    }
}

/* The turn that tells the chat how the person answered its card. */
export function answerWake(
    proposal: Pick<TunnelProposal, 'action' | 'hostname' | 'port' | 'origin'>,
    outcome: 'confirmed' | 'declined'
): { text: string; label: string } {
    const words = changeWords(proposal);

    if (outcome === 'declined') {
        return { text: `Declined: ${words}. Nothing changed.`, label: 'Tunnel: declined' };
    }

    const serves = proposal.action === 'off' || proposal.action === 'remove' ? '' : ' tunnel_list shows whether it is reachable.';

    return { text: `Confirmed: ${words}. Ruimte made the change.${serves}`, label: 'Tunnel: confirmed' };
}

function keyOf(chatId: string, hostname: string): string {
    return JSON.stringify([chatId, hostname]);
}

function holdKeyOf(proposalId: string): string {
    return `tunnel-proposal:${proposalId}`;
}

/* What a row is as far as a card goes: anything a person or another card changed since makes the card stand for something else. */
function fingerprintOf(row: Readonly<StoredRow> | undefined): string | null {
    if (row === undefined) {
        return null;
    }

    return JSON.stringify([row.kind, row.hostname, row.port, row.enabled, row.origin ?? null, row.leaving === true]);
}

/*
 * The cards in which an agent suggests a change to a hostname of Ruimte's, one per chat and hostname: a second
 * suggestion for the same hostname joins the card that stands. Nothing changes here until a person confirms, and a
 * confirm runs the change the screen makes, with its checks, so only that confirm changes what the person asked of a
 * row. A card for a row that changed since goes stale and refuses. The call never waits for the person: a confirm or
 * a decline wakes the chat with the outcome, and a card that went stale or expired reaches the agent with its next
 * suggestion of the same change, once. Every outcome stays in the list of its chat.
 */
export class TunnelProposals {
    private readonly tunnels: ProposalTunnels;
    private readonly chats: ProposalChats;
    private readonly publishList: (proposals: TunnelProposal[]) => void;
    private readonly answered: (chatId: string, wake: { text: string; label: string }) => void;
    private readonly now: () => number;
    private readonly timers: Timers;
    private readonly cardMs: number;
    private readonly pending = new Map<string, Pending>();
    /* What became of the last card of a hostname, for the agent's next suggestion of the very same change. */
    private readonly unheard = new Map<string, { answer: TunnelProposalAnswer; change: string }>();
    private readonly settled = new Map<string, TunnelProposalSettled[]>();

    constructor(options: TunnelProposalsOptions) {
        this.tunnels = options.tunnels;
        this.chats = options.chats;
        this.publishList = options.publish;
        this.answered = options.answered ?? (() => undefined);
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? realTimers;
        this.cardMs = options.cardMs ?? TUNNEL_PROPOSAL_CARD_MS;
    }

    /* Checks the change as the screen would, then raises the card or joins the one that stands; throws a `TunnelConfigError` for a change the screen refuses. */
    ask(ask: TunnelProposalAsk): TunnelProposalAnswer {
        const key = keyOf(ask.chatId, ask.hostname);
        const told = this.unheard.get(key);

        // Only the same suggestion hears what became of the last one; another change of the hostname is a new card.
        if (told !== undefined && !this.pending.has(key)) {
            this.unheard.delete(key);

            if (told.change === JSON.stringify(ask.change)) {
                return told.answer;
            }
        }

        const { change } = ask;

        if (change.action === 'add') {
            this.tunnels.checkAdd(change.input);
        } else {
            this.tunnels.checkChange(change.rowId, change.action === 'remove' ? 'remove' : change.change);
        }

        return { proposalId: this.raise(key, ask).proposal.proposalId, outcome: 'waiting' };
    }

    list(): TunnelProposal[] {
        return [...this.pending.values()]
            .map((pending) => ({ ...pending.proposal, stale: this.isStale(pending) }))
            .sort((left, right) => left.createdAt - right.createdAt);
    }

    /* The cards of one chat that stand, and what became of its last ones, for the agent's own list. */
    of(chatId: string): { standing: TunnelProposal[]; settled: readonly TunnelProposalSettled[] } {
        return { standing: this.list().filter((proposal) => proposal.chatId === chatId), settled: this.settled.get(chatId) ?? [] };
    }

    /* The rows moved, so a card may have gone stale; every client hears the list again. */
    refresh(): void {
        if (this.pending.size > 0) {
            this.publish();
        }
    }

    /*
     * A person's yes, which makes the change the screen would make. False when the card is gone already. A card whose
     * row changed since refuses and stays, saying so; a change Cloudflare refused throws and the card stays for another try.
     */
    async confirm(proposalId: string): Promise<boolean> {
        const pending = this.find(proposalId);

        if (pending === undefined) {
            return false;
        }

        if (pending.confirming) {
            throw new TunnelConfigError('proposal-busy', `Ruimte is already changing ${pending.proposal.hostname}`);
        }

        if (this.isStale(pending)) {
            this.publish();

            throw new TunnelConfigError(
                'proposal-stale',
                `${pending.proposal.hostname} changed since the agent asked, so Ruimte changed nothing. Decline this and ask the agent again.`
            );
        }

        pending.confirming = true;

        try {
            await this.apply(pending.change);
        } finally {
            pending.confirming = false;
        }

        this.settle(pending, 'confirmed');

        return true;
    }

    /* A person's no; a stale card tells the agent so. False when the card is gone already. */
    decline(proposalId: string): boolean {
        const pending = this.find(proposalId);

        if (pending === undefined || pending.confirming) {
            return false;
        }

        this.settle(pending, this.isStale(pending) ? 'stale' : 'declined');

        return true;
    }

    /* The chat stopped running or is gone: nobody is left to hear an answer. */
    forget(chatId: string): void {
        const own = [...this.pending.values()].filter((pending) => pending.proposal.chatId === chatId && !pending.confirming);

        for (const pending of own) {
            this.close(pending);
        }

        for (const key of [...this.unheard.keys()]) {
            if ((JSON.parse(key) as string[])[0] === chatId) {
                this.unheard.delete(key);
            }
        }

        this.settled.delete(chatId);

        if (own.length > 0) {
            this.publish();
        }
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

    private apply(change: TunnelChange): Promise<unknown> {
        if (change.action === 'add') {
            return this.tunnels.add(change.input);
        }

        if (change.action === 'remove') {
            return this.tunnels.remove(change.rowId);
        }

        return this.tunnels.update(change.rowId, change.change);
    }

    /* Applying the card changes its own row, which is not the card going stale. */
    private isStale(pending: Pending): boolean {
        if (pending.confirming) {
            return false;
        }

        const rows = this.tunnels.rowsAsMeant();
        const { change } = pending;

        if (change.action === 'add') {
            return rows.some((row) => row.hostname === pending.proposal.hostname);
        }

        return fingerprintOf(rows.find((row) => row.id === change.rowId)) !== pending.seen;
    }

    private find(proposalId: string): Pending | undefined {
        return [...this.pending.values()].find((pending) => pending.proposal.proposalId === proposalId);
    }

    private seenOf(change: TunnelChange): string | null {
        return change.action === 'add' ? null : fingerprintOf(this.tunnels.rowsAsMeant().find((row) => row.id === change.rowId));
    }

    private raise(key: string, ask: TunnelProposalAsk): Pending {
        const now = this.now();
        const words = {
            chatId: ask.chatId,
            action: ask.change.action,
            kind: ask.kind,
            hostname: ask.hostname,
            port: ask.port,
            ...(ask.origin === undefined ? {} : { origin: ask.origin }),
            ...(ask.reason === undefined ? {} : { reason: ask.reason }),
            expiresAt: now + this.cardMs
        };
        const standing = this.pending.get(key);

        if (standing !== undefined && !standing.confirming) {
            standing.cancelExpiry();
            standing.proposal = { ...words, proposalId: standing.proposal.proposalId, createdAt: standing.proposal.createdAt };
            standing.change = ask.change;
            standing.seen = this.seenOf(ask.change);
            standing.cancelExpiry = this.expireLater(standing);
            this.publish();

            return standing;
        }

        if (standing !== undefined) {
            throw new TunnelConfigError('proposal-busy', `Ruimte is already changing ${ask.hostname} for a card a person confirmed`);
        }

        const ofChat = [...this.pending.values()].filter((pending) => pending.proposal.chatId === ask.chatId).length;

        if (ofChat >= MAX_CARDS_PER_CHAT || this.pending.size >= MAX_CARDS) {
            throw new TunnelConfigError('too-many-proposals', `At most ${MAX_CARDS_PER_CHAT} suggestions of a chat wait for a person at once`);
        }

        this.unheard.delete(key);

        const pending: Pending = {
            proposal: { ...words, proposalId: randomUUID(), createdAt: now },
            change: ask.change,
            seen: this.seenOf(ask.change),
            confirming: false,
            cancelExpiry: () => undefined
        };

        pending.cancelExpiry = this.expireLater(pending);
        this.pending.set(key, pending);
        this.chats.hold(ask.chatId, holdKeyOf(pending.proposal.proposalId));
        this.publish();

        return pending;
    }

    private expireLater(pending: Pending): () => void {
        return this.timers.set(() => {
            if (!pending.confirming) {
                this.settle(pending, 'expired');
            }
        }, this.cardMs);
    }

    private close(pending: Pending): void {
        const { chatId, hostname, proposalId } = pending.proposal;
        const key = keyOf(chatId, hostname);

        if (this.pending.get(key) !== pending) {
            return;
        }

        pending.cancelExpiry();
        this.pending.delete(key);
        this.chats.release(chatId, holdKeyOf(proposalId));
    }

    private settle(pending: Pending, outcome: Exclude<TunnelProposalOutcome, 'waiting'>): void {
        const { chatId, hostname, proposalId, action } = pending.proposal;
        const key = keyOf(chatId, hostname);

        if (this.pending.get(key) !== pending) {
            return;
        }

        this.close(pending);

        // A person's answer wakes the chat; an outcome nobody gave waits for the agent's next suggestion.
        if (outcome === 'confirmed' || outcome === 'declined') {
            this.answered(chatId, answerWake(pending.proposal, outcome));
        } else {
            this.unheard.set(key, { answer: { proposalId, outcome }, change: JSON.stringify(pending.change) });
        }

        this.settled.set(chatId, [{ proposalId, outcome, action, hostname }, ...(this.settled.get(chatId) ?? [])].slice(0, MAX_OUTCOMES_PER_CHAT));
        this.publish();
    }

    private publish(): void {
        this.publishList(this.list());
    }
}
