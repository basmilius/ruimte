import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatEvent, ProjectProposal } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import type { SessionEvent } from '../wire.ts';
import { ProjectProposals, PROPOSAL_CARD_MS, type ProposalAsk } from './project-proposals.ts';

const ask: ProposalAsk = { chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' };

let timers: ManualTimers;
let holds: Map<string, Set<string>>;
let published: ProjectProposal[][];
let woken: Array<{ chatId: string; text: string; label: string }>;
let proposals: ProjectProposals;

function heldKeys(chatId: string): string[] {
    return [...(holds.get(chatId) ?? [])];
}

function chatEvent(chatId: string, event: ChatEvent): SessionEvent {
    return { event: 'chat.event', payload: { chatId, event } } as SessionEvent;
}

beforeEach(() => {
    timers = new ManualTimers();
    holds = new Map();
    published = [];
    woken = [];
    proposals = new ProjectProposals({
        chats: {
            hold: (chatId, key) => holds.set(chatId, new Set([...(holds.get(chatId) ?? []), key])),
            release: (chatId, key) => holds.get(chatId)?.delete(key)
        },
        answered: (chatId, wake) => woken.push({ chatId, ...wake }),
        now: () => timers.now,
        timers
    });
    proposals.subscribe('client', (event) => {
        if (event.event === 'chat.proposals') {
            published.push(event.payload.proposals);
        }
    });
});

describe('a project suggestion', () => {
    test('raises one card, holds the chat for a person, tells every client and answers waiting at once', () => {
        const answer = proposals.ask(ask);
        const [card] = proposals.list();
        expect(answer).toEqual({ proposalId: card!.proposalId, outcome: 'waiting' });
        expect(card).toMatchObject({ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' });
        expect(heldKeys('chat-1')).toHaveLength(1);
        expect(proposals.stands('chat-1')).toBe(true);
        expect(published.at(-1)).toEqual([card!]);
    });

    test('a person who reviews it and moves the chat takes the card down, frees the chat and wakes it there once', () => {
        proposals.ask(ask);
        proposals.moved('chat-1', 'Vinyl');
        proposals.moved('chat-1', 'Vinyl');
        expect(proposals.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
        expect(proposals.stands('chat-1')).toBe(false);
        expect(woken).toEqual([{ chatId: 'chat-1', text: 'Confirmed: this chat is now the project Vinyl.', label: 'Project: confirmed' }]);
    });

    test('a move that stopped halfway, or one with no card up, wakes nobody', () => {
        proposals.ask(ask);
        proposals.moved('chat-1');
        expect(proposals.list()).toEqual([]);
        proposals.moved('chat-2', 'Elsewhere');
        expect(woken).toEqual([]);
    });

    test('a decline while a move holds the card loses to the move, and counts again once the move is put back', () => {
        const { proposalId } = proposals.ask(ask);
        const putBack = proposals.pauseHold('chat-1')!;
        expect(proposals.decline(proposalId)).toBe(false);
        expect(woken).toEqual([]);
        putBack();
        expect(proposals.decline(proposalId)).toBe(true);
        expect(woken.map((wake) => wake.label)).toEqual(['Project: declined']);
    });

    test('a decline wakes the chat once, and a second client that answers late hears it lost', () => {
        const { proposalId } = proposals.ask(ask);
        expect(proposals.decline(proposalId)).toBe(true);
        expect(proposals.decline(proposalId)).toBe(false);
        expect(heldKeys('chat-1')).toEqual([]);
        expect(woken).toEqual([{ chatId: 'chat-1', text: 'Declined: make this chat the project Vinyl shelf. Nothing changed.', label: 'Project: declined' }]);
        // The wake told it, so the next suggestion raises a new card.
        expect(proposals.ask(ask)).toMatchObject({ outcome: 'waiting' });
        expect(proposals.list()[0]?.proposalId).not.toBe(proposalId);
    });

    test('suggesting again joins the card that stands, with the new words', () => {
        const { proposalId } = proposals.ask(ask);
        expect(proposals.ask({ ...ask, name: 'Vinyl' }).proposalId).toBe(proposalId);
        expect(proposals.list()).toHaveLength(1);
        expect(proposals.list()[0]).toMatchObject({ proposalId, name: 'Vinyl' });
    });

    test('a folder left out the second time is gone from the card', () => {
        proposals.ask(ask);
        proposals.ask({ chatId: 'chat-1', name: 'Vinyl shelf', reason: 'Still a codebase' });
        expect(proposals.list()[0]).not.toHaveProperty('folder');
    });

    test('a card outlasts the turn that raised it and goes after a day without a new ask', () => {
        proposals.ask(ask);
        proposals.observe(
            chatEvent('chat-1', {
                type: 'item',
                item: { id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'done', endedAt: 1, costUsd: 0 }
            } as ChatEvent)
        );
        expect(proposals.list()).toHaveLength(1);
        timers.advance(PROPOSAL_CARD_MS);
        expect(proposals.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
        // A card that only lapsed tells the agent nothing.
        expect(woken).toEqual([]);
    });

    test('a chat that stops or goes cancels the card', () => {
        proposals.ask(ask);
        proposals.observe(chatEvent('chat-1', { type: 'info', info: { status: 'exited' } } as ChatEvent));
        expect(proposals.list()).toEqual([]);

        proposals.ask(ask);
        proposals.forget('chat-1');
        expect(proposals.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
    });
});
