import type { AccountsHost } from '@ruimte/agents/providers/accounts/variables';

// The keychain prefix names where every sensitive value a person saved already sits; changing it loses them.
export const RUIMTE_ACCOUNTS_HOST: AccountsHost = { name: 'Ruimte', variablePrefixes: ['RUIMTE_'], keychainPrefix: 'ruimte' };
