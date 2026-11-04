import { accountHandlers } from '@adecore/agents/host';
import type { ProviderAccountsService } from '@adecore/agents/providers';
import type { Dispatcher } from '../dispatcher.ts';
import { registerAgentHandlers } from './agent.ts';

/* Any client the machine let in may change them: the accounts are the person's settings of this machine, and no tool reaches them. */
export function registerProviderAccountHandlers(dispatcher: Dispatcher, accounts: ProviderAccountsService): void {
    registerAgentHandlers(dispatcher, accountHandlers(accounts));
}
