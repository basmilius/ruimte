import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';

/* A paired client may change them: the accounts are the person's settings of this machine, and no verb reaches them. */
export const registerProviderAccountHandlers = (dispatcher: Dispatcher, accounts: ProviderAccountsService): void => {
    dispatcher.register('providers.list', () => accounts.snapshot());

    dispatcher.register('providers.save', (payload) => translate(() => accounts.save(payload.accounts)));

    dispatcher.register('providers.refresh', () => accounts.refresh());
};
