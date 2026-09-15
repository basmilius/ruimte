import { describe, expect, test } from 'bun:test';
import { AddressBookRequestError, type RegisterMachinePayload } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { AutoRegistrar, REGISTER_RETRY_MAX_MS, REGISTER_RETRY_MIN_MS, announcedRecordOf, type AccountList, type MachineRecord } from './auto-register';

const KEY = 'A'.repeat(43);

const registrationFor = (machineId: string): RegisterMachinePayload => ({
    id: machineId,
    name: machineId,
    icon: null,
    publicKey: KEY,
    issuedAt: 0,
    signature: 'S'.repeat(86)
});

const recordOf = (overrides: Partial<MachineRecord> = {}): MachineRecord => ({
    name: 'Studio',
    icon: { kind: 'lucide', value: 'server' },
    brokerUrl: null,
    publicKey: KEY,
    ...overrides
});

const emptyList: AccountList = { records: new Map(), removed: new Set() };

const listWith = (machineId: string, record: MachineRecord): AccountList => ({ records: new Map([[machineId, record]]), removed: new Set() });

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
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('registered');
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('skipped');
        expect(posted).toHaveLength(1);
        expect(posted[0]?.automatic).toBe(true);
    });

    test('leaves a machine alone whose record matches, or that a person removed', async () => {
        const { registrar, signed } = setup();
        expect(await registrar.consider('studio', 'studio', listWith('studio', recordOf()), recordOf())).toBe('skipped');
        expect(await registrar.consider('studio', 'studio', listWith('studio', recordOf()), null)).toBe('skipped');
        expect(await registrar.consider('desk', 'desk', { records: new Map(), removed: new Set(['desk']) }, recordOf())).toBe('skipped');
        const renamedButRemoved: AccountList = { records: new Map([['desk', recordOf()]]), removed: new Set(['desk']) };
        expect(await registrar.consider('desk', 'desk', renamedButRemoved, recordOf({ name: 'Desk' }))).toBe('skipped');
        expect(signed).toEqual([]);
    });

    test('a changed name, icon, broker or key registers again exactly once', async () => {
        const changes: Partial<MachineRecord>[] = [
            { name: 'Studio 2' },
            { icon: { kind: 'emoji', value: '🎛️' } },
            { brokerUrl: 'wss://broker.ruimte.test' },
            { publicKey: 'B'.repeat(43) }
        ];
        for (const change of changes) {
            const { registrar, posted } = setup();
            const stale = listWith('studio', recordOf());
            expect(await registrar.consider('studio', 'studio', stale, recordOf(change))).toBe('registered');
            // The list has not caught up with the write yet, and the sweeps after it must not post again.
            expect(await registrar.consider('studio', 'studio', stale, recordOf(change))).toBe('skipped');
            expect(await registrar.consider('studio', 'studio', listWith('studio', recordOf(change)), recordOf(change))).toBe('skipped');
            expect(posted).toHaveLength(1);
        }
    });

    test('a record that can never match, such as a name past the cap, is not registered again on every sweep', async () => {
        const { registrar, posted } = setup();
        const long = recordOf({ name: 'x'.repeat(100) });
        expect(await registrar.consider('studio', 'studio', listWith('studio', recordOf({ name: 'x'.repeat(80) })), long)).toBe('skipped');
        const unstorable = recordOf({ icon: { kind: 'image', value: 'a.png' } });
        const listed = listWith('studio', recordOf({ icon: null }));
        expect(await registrar.consider('studio', 'studio', listed, unstorable)).toBe('skipped');
        expect(posted).toHaveLength(0);
    });

    test('a removal the list did not know yet is taken from the answer, and not asked again', async () => {
        const { registrar, posted } = setup(async () => {
            throw new AddressBookRequestError('removed', 409, 'This machine was taken off the account');
        });
        expect(await registrar.consider('desk', 'desk', emptyList, null)).toBe('removed');
        expect(await registrar.consider('desk', 'desk', emptyList, null)).toBe('skipped');
        expect(await registrar.consider('desk', 'desk', listWith('desk', recordOf()), recordOf({ name: 'Desk' }))).toBe('skipped');
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
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('failed');
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('skipped');
        advance(REGISTER_RETRY_MIN_MS - 1);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('skipped');
        advance(1);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('failed');
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('skipped');
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('failed');
        expect(posted).toHaveLength(3);

        for (let i = 0; i < 10; i++) {
            advance(REGISTER_RETRY_MAX_MS);
            await registrar.consider('studio', 'studio', emptyList, null);
        }
        const waiting = registrar.nextRetryAt();
        advance(0);
        expect(waiting).not.toBeNull();

        failing = false;
        advance(REGISTER_RETRY_MAX_MS);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('registered');
        expect(registrar.nextRetryAt()).toBeNull();
    });

    test('an update that fails backs off like a first registration', async () => {
        const { registrar, posted, advance } = setup(async () => {
            throw new AddressBookRequestError('network', 0, 'The address book could not be reached');
        });
        const stale = listWith('studio', recordOf());
        expect(await registrar.consider('studio', 'studio', stale, recordOf({ name: 'Studio 2' }))).toBe('failed');
        expect(await registrar.consider('studio', 'studio', stale, recordOf({ name: 'Studio 2' }))).toBe('skipped');
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', stale, recordOf({ name: 'Studio 2' }))).toBe('failed');
        expect(posted).toHaveLength(2);
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
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('failed');
        expect(registrar.nextRetryAt()).toBe(REGISTER_RETRY_MIN_MS);
    });

    test('keeps the reason a machine failed with until it registers, and forgets it with the account', async () => {
        let failing = true;
        const { registrar, advance } = setup(async () => {
            if (failing) {
                throw new AddressBookRequestError('bad-signature', 403, 'The machine did not sign this registration for this account');
            }
        });
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('failed');
        expect((registrar.failedMachines().get('studio') as Error).message).toBe('The machine did not sign this registration for this account');
        failing = false;
        advance(REGISTER_RETRY_MIN_MS);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('registered');
        expect(registrar.failedMachines().size).toBe(0);

        failing = true;
        expect(await registrar.consider('desk', 'desk', emptyList, null)).toBe('failed');
        registrar.setAccount('account-2');
        expect(registrar.failedMachines().size).toBe(0);
    });

    test('nothing without an account, and another account starts over', async () => {
        const { registrar, posted } = setup();
        registrar.setAccount(null);
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('skipped');
        registrar.setAccount('account-1');
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('registered');
        registrar.setAccount('account-2');
        expect(await registrar.consider('studio', 'studio', emptyList, null)).toBe('registered');
        expect(posted).toHaveLength(2);
    });
});

describe('announcedRecordOf', () => {
    // The row of the machine the app runs on reaches it with the local secret, so it never pins a key.
    const localRow: Endpoint = {
        id: LOCAL_ENDPOINT_ID,
        label: 'This MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:4211',
        wsBaseUrl: 'ws://127.0.0.1:4211',
        reachability: 'loopback',
        token: null,
        daemonId: 'macbook',
        daemonPublicKey: null,
        brokerUrl: 'wss://broker.ruimte.test'
    };

    test('the local row brings a stale record on the signed-in account up to date', async () => {
        const { registrar, posted } = setup();
        const stale = listWith('macbook', recordOf({ name: 'MacBook-Pro.local', icon: null, brokerUrl: null }));
        const current = announcedRecordOf(localRow, { label: 'MacBook Pro', icon: { kind: 'lucide', value: 'laptop' }, publicKey: KEY });
        expect(current).toEqual({ name: 'MacBook Pro', icon: { kind: 'lucide', value: 'laptop' }, brokerUrl: 'wss://broker.ruimte.test', publicKey: KEY });
        expect(await registrar.consider(localRow.id, 'macbook', stale, current)).toBe('registered');
        expect(posted).toHaveLength(1);
    });

    test('a pinned key wins over the one the machine announces, and nothing is known before the machine answers', () => {
        const paired = { ...localRow, id: 'studio', daemonPublicKey: 'B'.repeat(43) };
        expect(announcedRecordOf(paired, { label: 'Studio', icon: null, publicKey: KEY })?.publicKey).toBe('B'.repeat(43));
        expect(announcedRecordOf(localRow, { label: null, icon: null, publicKey: KEY })).toBeNull();
        expect(announcedRecordOf(localRow, { label: 'MacBook Pro', icon: null, publicKey: null })).toBeNull();
    });
});
