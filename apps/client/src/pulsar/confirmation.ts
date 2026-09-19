import i18next from 'i18next';
import { create } from 'zustand';
import { PROVIDER_NAMES, type Account, type ProviderId } from '@ruimte/pulsar';

/*
 * The line at the top of the account section that says a sign-in or an added provider went through.
 * Signing in ends in a browser, so without it a person comes back to a pane that changed while they
 * were away and nothing that says it worked. A failure is the account's `error`, which waits to be read.
 */

interface ConfirmationState {
    text: string | null;
}

export const useAccountConfirmation = create<ConfirmationState>(() => ({ text: null }));

/* Stays until the person dismisses it or the next attempt starts, since they may come back to it late. */
export const confirmAccount = (text: string): void => {
    useAccountConfirmation.setState({ text });
};

export const dismissAccountConfirmation = (): void => {
    useAccountConfirmation.setState({ text: null });
};

/* Named after the provider the person picked, since the account may be shown as another one. */
export const signedInConfirmation = (provider: ProviderId, account: Account): string =>
    account.login === null
        ? i18next.t('machines:account.confirmation.signedIn', { provider: PROVIDER_NAMES[provider] })
        : i18next.t('machines:account.confirmation.signedInAs', { provider: PROVIDER_NAMES[provider], login: account.login });

export const linkedConfirmation = (provider: ProviderId): string => i18next.t('machines:account.confirmation.linked', { provider: PROVIDER_NAMES[provider] });
