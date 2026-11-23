import { useProposals } from '@/proposals/proposals';
import { useSecrets } from '@/secrets/secrets';
import { endpointKey } from '@/state/keys';
import { useTunnelProposals } from '@/state/tunnel-proposals';

interface CardWait {
    endpointId: string;
    chatId: string;
    createdAt: number;
}

/* The oldest card of each chat, by endpoint key. */
export function cardWaitsOf(cards: readonly CardWait[]): ReadonlyMap<string, number> {
    const waits = new Map<string, number>();

    for (const card of cards) {
        const key = endpointKey(card.endpointId, card.chatId);

        waits.set(key, Math.min(waits.get(key) ?? Infinity, card.createdAt));
    }

    return waits;
}

/*
 * When each chat began to wait on a card of Ruimte's own (a secret, a project or a tunnel suggestion).
 * Such a card holds the chat without a request of its CLI, so this is what dates its wait and makes it
 * read as a question.
 */
export function useCardWaits(): ReadonlyMap<string, number> {
    const secrets = useSecrets((state) => state.requests);
    const proposals = useProposals((state) => state.proposals);
    const tunnels = useTunnelProposals((state) => state.proposals);

    return cardWaitsOf([
        ...Object.entries(secrets).flatMap(([endpointId, list]) => list.map((card) => ({ endpointId, chatId: card.nodeId, createdAt: card.createdAt }))),
        ...Object.entries(proposals).flatMap(([endpointId, list]) => list.map((card) => ({ endpointId, chatId: card.chatId, createdAt: card.createdAt }))),
        ...Object.entries(tunnels).flatMap(([endpointId, list]) => list.map((card) => ({ endpointId, chatId: card.chatId, createdAt: card.createdAt })))
    ]);
}
