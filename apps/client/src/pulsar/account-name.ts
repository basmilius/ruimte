import i18next from 'i18next';
import { PROVIDER_NAMES, type Account, type Identity, type ProviderId } from '@ruimte/pulsar';

/*
 * How an account and its identities are named in a sentence. Apple hands out no login, so an account
 * or an identity without one is named after its provider instead of left blank.
 */

// The order sign-in choices are drawn in, whatever order an address book lists them.
export const PROVIDER_ORDER: readonly ProviderId[] = ['github', 'apple'];

/* "someone" for a GitHub login, "your Apple ID" for an account shown as Apple. */
export const accountName = (account: Account): string => account.login ?? i18next.t(`machines:account.yours.${account.provider}`);

export const signedInLabel = (account: Account): string =>
    account.login === null
        ? i18next.t('machines:account.signedInWithProvider', { provider: PROVIDER_NAMES[account.provider] })
        : i18next.t('machines:account.signedInAsLogin', { login: account.login });

/* The line under an identity's row: its login, or what it is when there is none. */
export const identityDetail = (identity: Identity): string => identity.login ?? i18next.t(`machines:account.noun.${identity.provider}`);

/* The warning under a signed-in account, naming every identity that opens it. */
export const takeoverWarning = (providers: readonly ProviderId[]): string => {
    const names = PROVIDER_ORDER.filter((provider) => providers.includes(provider)).map((provider) => i18next.t(`machines:account.this.${provider}`));
    return i18next.t('machines:account.takeover.warning', { names: names.join(` ${i18next.t('machines:account.takeover.or')} `) });
};

/* The providers an address book offers that this client knows, in drawing order. */
export const offeredProviders = (listed: readonly string[]): ProviderId[] => PROVIDER_ORDER.filter((provider) => listed.includes(provider));
