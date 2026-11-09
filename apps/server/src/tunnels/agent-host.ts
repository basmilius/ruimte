import type { TunnelNamed, TunnelProposal, TunnelState } from '@ruimte/contracts';
import type { TunnelProposalAnswer, TunnelProposalAsk, TunnelProposals, TunnelProposalSettled } from './tunnel-proposals.ts';
import type { TunnelService } from './tunnel-service.ts';
import type { StoredRow } from './tunnel-store.ts';

/*
 * This machine's tunnel as an agent reaches it: it reads the state every client reads, and changes nothing itself. A
 * suggestion only raises a card, refused with a `TunnelConfigError` the way the screen refuses the change.
 */
export interface TunnelAgentHost {
    state(): Promise<TunnelState>;
    rowsAsMeant(): readonly StoredRow[];
    /* The zone of the tunnel's account a hostname is in; null for none the token reaches there. */
    zoneOf(hostname: string): TunnelNamed | null;
    propose(ask: TunnelProposalAsk): TunnelProposalAnswer;
    of(chatId: string): { standing: TunnelProposal[]; settled: readonly TunnelProposalSettled[] };
}

interface TunnelAgentDeps {
    service: Pick<TunnelService, 'state' | 'rowsAsMeant' | 'zoneOf'>;
    proposals: Pick<TunnelProposals, 'ask' | 'of'>;
}

/* Read at every call: the tunnels are wired after the services an agent reaches the daemon through. */
export function tunnelAgentHost(tunnels: () => TunnelAgentDeps): TunnelAgentHost {
    return {
        state: () => tunnels().service.state(),
        rowsAsMeant: () => tunnels().service.rowsAsMeant(),
        zoneOf: (hostname) => tunnels().service.zoneOf(hostname),
        propose: (ask) => tunnels().proposals.ask(ask),
        of: (chatId) => tunnels().proposals.of(chatId)
    };
}
