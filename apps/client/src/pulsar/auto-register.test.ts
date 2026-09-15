import { describe, expect, test } from 'bun:test';
import { AddressBookRequestError, type RegisterMachinePayload } from '@ruimte/pulsar';
import { AutoRegistrar, REGISTER_RETRY_MAX_MS, REGISTER_RETRY_MIN_MS, type AccountList } from './auto-register';

const registrationFor = (machineId: string): RegisterMachinePayload => ({
    id: machineId,
    name: machineId,
    icon: null,
    publicKey: 'A'.repeat(43),
    issuedAt: 0,
    signature: 'S'.repeat(86)
});

const emptyList: AccountList = { onAccount: new Set(), removed: new Set() };

const setup = (register: (payload: RegisterMachinePayload) => Promise<void> = async () => undefined) => {
    let now = 1_000_000;
    const signed: string[] = [];
    const posted: RegisterMachinePayload[] = [];
    const registrar = new AutoRegistrar({
        now: () => now,
        sign: async (endpointId) => {
            signed.push(endpointId);
            return registrationFor(endpointId);
        },
        register: async (payload) => {
            posted.push(payload);
            await register(payload);
        }
    });
    registrar.setAccount('account-1');
    return {
        registrar,
        signed,
        posted,
        advance: (ms: number) => {
            now += ms;
        }
    };
};

describe('AutoRegistrar', () => {
    test('registers a machine it reaches once, marked automatic, however often it connects', async () => {
        const { registrar, posted } = setup();
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('registered');
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('skipped');
        expect(posted).toHaveLength(1);
        expect(posted[0]?.automatic).toBe(true);
    });

    test('leaves a machine alone that is on the account already, or that a person removed', async () => {
        const { registrar, signed } = setup();
        expect(await registrar.consider('studio', 'studio', { onAccount: new Set(['studio']), removed: new Set() })).toBe('skipped');
        expect(await registrar.consider('desk', 'desk', { onAccount: new Set(), removed: new Set(['desk']) })).toBe('skipped');
        expect(signed).toEqual([]);
    });

    test('a removal the list did not know yet is taken from the answer, and not asked again', async () => {
        const { registrar, posted } = setup(async () => {
            throw new AddressBookRequestError('removed', 409, 'This machine was taken off the account');
        });
        expect(await registrar.consider('desk', 'desk', emptyList)).toBe('removed');
        expect(await registrar.consider('desk', 'desk', emptyList)).toBe('skipped');
        expect(posted).toHaveLength(1);
        expect(registrar.nextRetryAt()).toBeNull();
    });

    test('backs off after a failure, longer each time, up to the cap', async () => {
        let failing = true;
        const { registrar, posted, advance } = setup(async () => {
            if (failing) {
                throw new AddressBookRequestError('network', 0, 'The address book could not be reached');
            }
        });
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('failed');
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('skipped');
        advance(REGISTER_RETRY_MIN_MS - 1);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('skipped');
        advance(1);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('failed');
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('skipped');
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('failed');
        expect(posted).toHaveLength(3);

        for (let i = 0; i < 10; i++) {
            advance(REGISTER_RETRY_MAX_MS);
            await registrar.consider('studio', 'studio', emptyList);
        }
        const waiting = registrar.nextRetryAt();
        advance(0);
        expect(waiting).not.toBeNull();

        failing = false;
        advance(REGISTER_RETRY_MAX_MS);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('registered');
        expect(registrar.nextRetryAt()).toBeNull();
    });

    test('a failure that cannot even be signed backs off the same way', async () => {
        const registrar = new AutoRegistrar({
            now: () => 0,
            sign: async () => {
                throw new Error('That machine is not answering');
            },
            register: async () => undefined
        });
        registrar.setAccount('account-1');
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('failed');
        expect(registrar.nextRetryAt()).toBe(REGISTER_RETRY_MIN_MS);
    });

    test('nothing without an account, and another account starts over', async () => {
        const { registrar, posted } = setup();
        registrar.setAccount(null);
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('skipped');
        registrar.setAccount('account-1');
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('registered');
        registrar.setAccount('account-2');
        expect(await registrar.consider('studio', 'studio', emptyList)).toBe('registered');
        expect(posted).toHaveLength(2);
    });
});
