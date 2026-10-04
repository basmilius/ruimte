import { describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { rowsRemovedFromAccount } from './removal';

function row(id: string, overrides: Partial<Endpoint> = {}): Endpoint {
    return {
        id,
        label: id,
        httpBaseUrl: '',
        wsBaseUrl: '',
        reachability: 'public',
        daemonId: id,
        daemonPublicKey: null,
        pairedBy: 'statement',
        ...overrides
    };
}

describe('rowsRemovedFromAccount', () => {
    test('a removed machine goes, and one still on the account stays', () => {
        const endpoints = [row('studio'), row('attic'), row('kept')];
        expect(rowsRemovedFromAccount(endpoints, ['studio', 'attic'])).toEqual(['studio', 'attic']);
    });

    test('a row is matched on its daemon id', () => {
        expect(rowsRemovedFromAccount([row('row-id', { daemonId: 'studio' })], ['studio'])).toEqual(['row-id']);
    });

    test('the row of this machine stays', () => {
        const endpoints = [row(LOCAL_ENDPOINT_ID, { daemonId: 'home' }), row('studio')];
        expect(rowsRemovedFromAccount(endpoints, ['home'])).toEqual([]);
    });
});
