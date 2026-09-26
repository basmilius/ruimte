import i18next from 'i18next';
import type { ProviderInfo } from '@ruimte/agent-contracts';

/* What a provider offers, in one sentence, where it can be opened and whether its hooks report status. */
export const providerAbilities = (provider: ProviderInfo): string => {
    const where = provider.capabilities.chat ? i18next.t('agent-providers:abilities.chatAndTerminal') : i18next.t('agent-providers:abilities.terminalOnly');
    const status = provider.capabilities.hooks ? i18next.t('agent-providers:abilities.reportsStatus') : i18next.t('agent-providers:abilities.noStatus');
    return `${where} ${status}`;
};
