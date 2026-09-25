import i18next from 'i18next';
import type { ProviderInfo } from '@ruimte/contracts';

/* What a provider offers, in one sentence, where it can be opened and whether its hooks report status. */
export const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat
        ? i18next.t('settings:providers.abilities.chatAndTerminal')
        : i18next.t('settings:providers.abilities.terminalOnly');
    const status = provider.capabilities.hooks ? i18next.t('settings:providers.abilities.reportsStatus') : i18next.t('settings:providers.abilities.noStatus');
    return `${where} ${status}`;
};
