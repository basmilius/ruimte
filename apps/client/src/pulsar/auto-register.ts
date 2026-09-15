import { AddressBookRequestError, type RegisterMachinePayload } from '@ruimte/pulsar';

// The first wait after a failed registration, doubled with every failure after it up to the cap.
export const REGISTER_RETRY_MIN_MS = 30_000;
export const REGISTER_RETRY_MAX_MS = 30 * 60_000;

export interface AutoRegistrarDeps {
    /* The machine behind this row signs its agreement to join the account. */
    sign(endpointId: string, accountId: string): Promise<RegisterMachinePayload>;
    register(payload: RegisterMachinePayload): Promise<void>;
    now?: () => number;
}

/* What the account list said last: the machines on it, and the ones a person took off. */
export interface AccountList {
    onAccount: ReadonlySet<string>;
    removed: ReadonlySet<string>;
}

export type RegisterOutcome = 'registered' | 'removed' | 'skipped' | 'failed';

interface Failure {
    count: number;
    retryAt: number;
}

/*
 * Puts the machines this client reaches on the account it is signed in to, without a button. Once per
 * machine per account for as long as the page lives: registering is idempotent at the address book, but
 * a client that reconnects all day must not ask it all day. A machine a person removed is left alone,
 * whether the list said so or the address book answered `removed`, and a failure waits longer every
 * time, so a machine that cannot sign or an address book that is down costs a request now and then.
 */
export class AutoRegistrar {
    private readonly deps: AutoRegistrarDeps;
    private readonly now: () => number;
    private accountId: string | null = null;
    private readonly settled = new Set<string>();
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
        this.inFlight.clear();
        this.failures.clear();
    }

    async consider(endpointId: string, machineId: string, list: AccountList): Promise<RegisterOutcome> {
        const accountId = this.accountId;
        if (accountId === null || list.onAccount.has(machineId) || list.removed.has(machineId) || this.settled.has(machineId) || this.inFlight.has(machineId)) {
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
            this.failures.delete(machineId);
            return 'registered';
        } catch (e) {
            if (this.accountId !== accountId) {
                return 'skipped';
            }
            if (e instanceof AddressBookRequestError && e.code === 'removed') {
                this.settled.add(machineId);
                this.failures.delete(machineId);
                return 'removed';
            }
            const count = (failure?.count ?? 0) + 1;
            this.failures.set(machineId, { count, retryAt: this.now() + Math.min(REGISTER_RETRY_MIN_MS * 2 ** (count - 1), REGISTER_RETRY_MAX_MS) });
            return 'failed';
        } finally {
            this.inFlight.delete(machineId);
        }
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
