import { accountHandlers } from '@ruimte/agents/host/handlers';
import type { ProviderAccountsService } from '@ruimte/agents/providers/accounts/service';
import type { Dispatcher } from '../dispatcher.ts';
import { registerAgentHandlers } from './agent.ts';

/* A paired client may change them: the accounts are the person's settings of this machine, and no verb reaches them. */
export const registerProviderAccountHandlers = (dispatcher: Dispatcher, accounts: ProviderAccountsService): void => {
    registerAgentHandlers(dispatcher, accountHandlers(accounts));
};
