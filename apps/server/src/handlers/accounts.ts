import { accountHandlers } from '@adecore/agents/host';
import type { ProviderAccountsService } from '@adecore/agents/providers';
import type { Area } from '../area.ts';
import { registerAgentHandlers } from './agent.ts';

interface AccountsDeps {
    accounts: ProviderAccountsService;
}

/* Any client the machine let in may change them: the accounts are the person's settings of this machine, and no tool reaches them. */
export function accountsArea({ accounts }: AccountsDeps): Area {
    return {
        name: 'accounts',
        sources: [accounts],
        handlers: (dispatcher) => registerAgentHandlers(dispatcher, accountHandlers(accounts)),
        stop: [{ phase: 'halt', label: 'Stopping accounts', run: () => accounts.stop() }]
    };
}
