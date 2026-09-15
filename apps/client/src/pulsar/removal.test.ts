import { describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { reclaimPairedMachine, rowsRemovedFromAccount, type ReclaimDeps } from './removal';

const row = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}:4210`,
    wsBaseUrl: `ws://${id}:4210`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: null,
    ...overrides
});

describe('rowsRemovedFromAccount', () => {
    test('a removed machine goes, a paired row and a row opened from the account alike', () => {
        const endpoints = [row('studio'), row('attic', { pairedBy: 'statement' }), row('kept')];
        expect(rowsRemovedFromAccount(endpoints, ['studio', 'attic'], [])).toEqual(['studio', 'attic']);
    });

    test('a row keyed on an address is matched on its daemon id', () => {
        expect(rowsRemovedFromAccount([row('host:4210', { daemonId: 'studio' })], ['studio'], [])).toEqual(['host:4210']);
    });

    test('the row of this machine stays, and so does a machine being put back', () => {
        const endpoints = [row(LOCAL_ENDPOINT_ID, { daemonId: 'home' }), row('studio')];
        expect(rowsRemovedFromAccount(endpoints, ['home', 'studio'], ['studio'])).toEqual([]);
    });
});

const recorder = () => {
    const calls: string[] = [];
    const reclaiming = new Set<string>();
    const deps: ReclaimDeps = {
        waitForOpen: async (endpointId) => {
            calls.push(`open ${endpointId}`);
        },
        addToAccount: async (endpointId) => {
            calls.push(`add ${endpointId}`);
        },
        setReclaiming: (machineId, on) => {
            calls.push(`${on ? 'mark' : 'unmark'} ${machineId}`);
            if (on) {
                reclaiming.add(machineId);
            } else {
                reclaiming.delete(machineId);
            }
        }
    };
    return { calls, reclaiming, deps };
};

describe('reclaimPairedMachine', () => {
    test('pairing a removed machine while signed in puts it back on the account', async () => {
        const { calls, reclaiming, deps } = recorder();
        const outcome = await reclaimPairedMachine(row('studio'), { signedIn: true, removedMachineIds: ['studio'] }, deps);
        expect(outcome).toBe('reclaimed');
        expect(calls).toEqual(['mark studio', 'open studio', 'add studio', 'unmark studio']);
        expect(reclaiming.size).toBe(0);
    });

    test('the removal rule leaves the new row alone while it is being put back', async () => {
        const { reclaiming, deps } = recorder();
        let during: string[] = [];
        deps.waitForOpen = async () => {
            during = rowsRemovedFromAccount([row('studio')], ['studio'], [...reclaiming]);
        };
        await reclaimPairedMachine(row('studio'), { signedIn: true, removedMachineIds: ['studio'] }, deps);
        expect(during).toEqual([]);
    });

    test('a failed registration keeps the mark, so the row outlives the next refresh', async () => {
        const { reclaiming, deps } = recorder();
        deps.addToAccount = async () => {
            throw new Error('address book down');
        };
        await expect(reclaimPairedMachine(row('studio'), { signedIn: true, removedMachineIds: ['studio'] }, deps)).rejects.toThrow('address book down');
        expect([...reclaiming]).toEqual(['studio']);
    });

    test('nothing happens for a machine that was not removed, or on a signed-out client', async () => {
        const { calls, deps } = recorder();
        expect(await reclaimPairedMachine(row('studio'), { signedIn: true, removedMachineIds: [] }, deps)).toBe('untouched');
        expect(await reclaimPairedMachine(row('studio'), { signedIn: false, removedMachineIds: ['studio'] }, deps)).toBe('untouched');
        expect(calls).toEqual([]);
    });
});
