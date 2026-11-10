import { PROVIDER_NAMES, type Account, type Identity, type ProviderId } from '@ruimte/pulsar';
import i18next from 'i18next';

/*
 * How an account and its identities are named in a sentence. Apple hands out no login, so an account
 * or an identity without one is named after its provider instead of left blank.
 */

// The order sign-in choices are drawn in, whatever order an address book lists them.
export const PROVIDER_ORDER: readonly ProviderId[] = ['github', 'apple'];

export function accountName(account: Account): string {
    return account.displayName ?? account.login ?? i18next.t(`machines:account.yours.${account.provider}`);
}

/* The login rather than the name, since the login is what tells one identity from another. */
export function signedInLabel(account: Account): string {
    return account.login === null
        ? i18next.t('machines:account.signedInWithProvider', { provider: PROVIDER_NAMES[account.provider] })
        : i18next.t('machines:account.signedInAsLogin', { login: account.login });
}

export function identityDetail(identity: Identity): string {
    return identity.login ?? i18next.t(`machines:account.noun.${identity.provider}`);
}

export function takeoverWarning(providers: readonly ProviderId[]): string {
    const names = PROVIDER_ORDER.filter((provider) => providers.includes(provider)).map((provider) => i18next.t(`machines:account.this.${provider}`));
    return i18next.t('machines:account.takeover.warning', { names: names.join(` ${i18next.t('machines:account.takeover.or')} `) });
}

export function offeredProviders(listed: readonly string[]): ProviderId[] {
    return PROVIDER_ORDER.filter((provider) => listed.includes(provider));
}
