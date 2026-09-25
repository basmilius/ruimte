import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';

/* A paired client may change them: the accounts are the person's settings of this machine, and no verb reaches them. */
export const registerProviderAccountHandlers = (dispatcher: Dispatcher, accounts: ProviderAccountsService): void => {
    dispatcher.register('accounts.list', () => accounts.snapshot());

    dispatcher.register('accounts.save', (payload) => translate(() => accounts.save(payload.accounts)));

    dispatcher.register('accounts.refresh', () => accounts.refresh());

    dispatcher.register('accounts.create', (payload) => translate(() => accounts.create(payload)));

    dispatcher.register('accounts.watchLogin', (payload) =>
        translate(() => {
            void accounts.watchLogin(payload.id);
            return {};
        })
    );
};
