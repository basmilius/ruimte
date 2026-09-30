import { describe, expect, test } from 'bun:test';
import { claimWindow, type WindowAddress } from './window-claim';

const fakeAddress = (initial: string): WindowAddress & { writes: string[] } => {
    let search = initial;
    const writes: string[] = [];
    return {
        writes,
        search: () => search,
        replace: (next) => {
            search = next;
            writes.push(next);
        }
    };
};

describe('claimWindow', () => {
    test('asks the shell for the key of the project and follows it in the address', async () => {
        const asked: (string | null)[] = [];
        const address = fakeAddress('?start=1');
        const granted = await claimWindow(
            { endpointId: 'local', projectId: 'p1' },
            {
                claimWindow: async (key) => {
                    asked.push(key);
                    return true;
                }
            },
            address
        );
        expect(granted).toBe(true);
        expect(asked).toEqual(['local:p1']);
        expect(address.writes).toEqual(['?project=local%3Ap1']);
    });

    test('a refusal leaves the address where it was', async () => {
        const address = fakeAddress('?project=local%3Ap0');
        expect(await claimWindow({ endpointId: 'local', projectId: 'p1' }, { claimWindow: async () => false }, address)).toBe(false);
        expect(address.writes).toEqual([]);
    });

    test('letting go asks for no key and puts the start screen in the address', async () => {
        const asked: (string | null)[] = [];
        const address = fakeAddress('?project=local%3Ap0');
        await claimWindow(
            null,
            {
                claimWindow: async (key) => {
                    asked.push(key);
                    return true;
                }
            },
            address
        );
        expect(asked).toEqual([null]);
        expect(address.search()).toBe('?start=1');
    });

    test('is granted without a shell that keeps windows, and the address stays as it is', async () => {
        const address = fakeAddress('');
        expect(await claimWindow({ endpointId: 'local', projectId: 'p1' }, {}, address)).toBe(true);
        expect(await claimWindow({ endpointId: 'local', projectId: 'p1' }, null, address)).toBe(true);
        expect(address.writes).toEqual([]);
    });

    test('a shell that fails to answer does not keep the project out', async () => {
        expect(await claimWindow({ endpointId: 'local', projectId: 'p1' }, { claimWindow: () => Promise.reject(new Error('gone')) }, null)).toBe(true);
    });
});
