import { AddressBookRequestError, MachineIconSchema, type RegisterMachinePayload } from '@ruimte/pulsar';
import type { Endpoint } from '@/state/endpoints';

// The first wait after a failed registration, doubled with every failure after it up to the cap.
export const REGISTER_RETRY_MIN_MS = 30_000;
export const REGISTER_RETRY_MAX_MS = 30 * 60_000;

// What the address book stores of a name; a longer label is cut to this before it is signed.
const MACHINE_NAME_MAX = 80;

export interface AutoRegistrarDeps {
    /* The machine behind this row signs its agreement to join the account. */
    sign(endpointId: string, accountId: string): Promise<RegisterMachinePayload>;
    register(payload: RegisterMachinePayload): Promise<void>;
    now?: () => number;
}

/* What a record on the account says about a machine, and what the machine says about itself right now. */
export interface MachineRecord {
    name: string;
    icon: unknown;
    brokerUrl: string | null;
    publicKey: string;
}

/* What the account list said last: the machines on it, and the ones a person took off. */
export interface AccountList {
    records: ReadonlyMap<string, MachineRecord>;
    removed: ReadonlySet<string>;
}

/* What a machine said in its last `endpoint.info`, as far as its record goes. */
export interface AnnouncedIdentity {
    label: string | null;
    icon: unknown;
    publicKey: string | null;
}

/*
 * What the machine behind a row says about itself right now; null until it has said who it is. The row
 * of this machine reaches it with the local secret and never pins a key, so the key it announces stands
 * in; a key a row pinned still wins.
 */
export const announcedRecordOf = (endpoint: Pick<Endpoint, 'brokerUrl' | 'daemonPublicKey'>, info: AnnouncedIdentity): MachineRecord | null => {
    const publicKey = endpoint.daemonPublicKey ?? info.publicKey;
    // The label and the broker arrive in one `endpoint.info`, so a known label means the broker is known too.
    if (info.label === null || publicKey === null) {
        return null;
    }
    return { name: info.label, icon: info.icon, brokerUrl: endpoint.brokerUrl ?? null, publicKey };
};

export type RegisterOutcome = 'registered' | 'removed' | 'skipped' | 'failed';

interface Failure {
    count: number;
    retryAt: number;
    error: unknown;
}

/*
 * Compared the way the daemon signs it: the name cut to what the address book keeps and an icon it cannot
 * store read as none, so a machine whose record can never match is not registered again on every sweep.
 */
const recordKeyOf = (record: MachineRecord): string => {
    const icon = MachineIconSchema.safeParse(record.icon);
    return JSON.stringify([record.name.slice(0, MACHINE_NAME_MAX), icon.success ? icon.data : null, record.brokerUrl, record.publicKey]);
};

/*
 * Registers each changed machine state once per account. Explicit removals stay removed, and failures
 * back off so an unavailable machine or address book does not cause a request loop.
 */
export class AutoRegistrar {
    private readonly deps: AutoRegistrarDeps;
    private readonly now: () => number;
    private accountId: string | null = null;
    private readonly settled = new Set<string>();
    private readonly refused = new Set<string>();
    private readonly synced = new Map<string, string>();
    private readonly inFlight = new Set<string>();
    private readonly failures = new Map<string, Failure>();

    constructor(deps: AutoRegistrarDeps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
    }

    /* Another account, or none, starts over: what was settled for one account says nothing about the next. */
    setAccount(accountId: string | null): void {
        if (accountId === this.accountId) {
            return;
        }
        this.accountId = accountId;
        this.settled.clear();
        this.refused.clear();
        this.synced.clear();
        this.inFlight.clear();
        this.failures.clear();
    }

    /* `current` is what the machine says about itself, null while this client has not heard it yet. */
    async consider(endpointId: string, machineId: string, list: AccountList, current: MachineRecord | null): Promise<RegisterOutcome> {
        const accountId = this.accountId;
        if (accountId === null || list.removed.has(machineId) || this.refused.has(machineId) || this.inFlight.has(machineId)) {
            return 'skipped';
        }
        const currentKey = current === null ? null : recordKeyOf(current);
        const record = list.records.get(machineId);
        if (record) {
            if (currentKey === null || currentKey === recordKeyOf(record) || this.synced.get(machineId) === currentKey) {
                return 'skipped';
            }
        } else if (this.settled.has(machineId)) {
            return 'skipped';
        }
        const failure = this.failures.get(machineId);
        if (failure && failure.retryAt > this.now()) {
            return 'skipped';
        }
        this.inFlight.add(machineId);
        try {
            const registration = await this.deps.sign(endpointId, accountId);
            await this.deps.register({ ...registration, automatic: true });
            if (this.accountId !== accountId) {
                return 'skipped';
            }
            this.settled.add(machineId);
            if (currentKey !== null) {
                this.synced.set(machineId, currentKey);
            }
            this.failures.delete(machineId);
            return 'registered';
        } catch (e) {
            if (this.accountId !== accountId) {
                return 'skipped';
            }
            if (e instanceof AddressBookRequestError && e.code === 'removed') {
                this.refused.add(machineId);
                this.failures.delete(machineId);
                return 'removed';
            }
            const count = (failure?.count ?? 0) + 1;
            this.failures.set(machineId, {
                count,
                retryAt: this.now() + Math.min(REGISTER_RETRY_MIN_MS * 2 ** (count - 1), REGISTER_RETRY_MAX_MS),
                error: e
            });
            return 'failed';
        } finally {
            this.inFlight.delete(machineId);
        }
    }

    /* The error each machine's last registration failed with, so a person can see why rather than only a retry. */
    failedMachines(): ReadonlyMap<string, unknown> {
        return new Map([...this.failures].map(([machineId, failure]) => [machineId, failure.error]));
    }

    /* When the earliest machine that failed may be asked again, for a timer; null when none is waiting. */
    nextRetryAt(): number | null {
        let earliest: number | null = null;
        for (const failure of this.failures.values()) {
            earliest = earliest === null ? failure.retryAt : Math.min(earliest, failure.retryAt);
        }
        return earliest;
    }
}
