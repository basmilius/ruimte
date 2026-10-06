import { expect, test } from 'bun:test';
import { keychainService, variablesProblem } from '@adecore/agents/providers/accounts/variables';
import { RUIMTE_ACCOUNTS_HOST } from './accounts-host.ts';

test('the values a person saved stay under the keychain service they were written to', () => {
    expect(keychainService(RUIMTE_ACCOUNTS_HOST, '/Users/bas/.ruimte')).toBe('ruimte-provider-env-8a1d10001889');
});

test('an account never sets a variable the daemon hands every CLI', () => {
    const reserved = { host: RUIMTE_ACCOUNTS_HOST, folderVariables: [] };
    expect(variablesProblem([{ name: 'RUIMTE_CONTEXT_URL', value: 'x', sensitive: false }], reserved)).toBe('RUIMTE_CONTEXT_URL is set by Ruimte itself');
});
