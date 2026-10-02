import { PULSAR_STATEMENT_PUBLIC_KEYS, accessStatementMessage, accessStatementV2Message, type AccessStatement, type SignalAccess } from '@ruimte/pulsar';
import type { StatementAdmission, StatementEntry } from '../auth/auth-store.ts';
import { isPublicKey, verifySignature } from '@ruimte/pulsar/verify-node';

/*
 * How far the address book's clock and this machine's may disagree. A statement lives two minutes, so
 * a wider allowance would let a clock that is off stretch that by more than the lifetime itself.
 */
export const STATEMENT_CLOCK_SKEW_MS = 30_000;

/*
 * The one way to make a daemon believe a key other than the pinned ones, for the Docker bench. A
 * compiled daemon never reads it: `scripts/compile.ts` defines it away, and `trustedStatementKeys`
 * checks for a compiled binary as well, so a release cannot be pointed at a key of someone's choosing.
 */
export const TEST_STATEMENT_KEY_VARIABLE = 'RUIMTE_PULSAR_TEST_STATEMENT_KEY';

export type StatementRefusal = 'wrong-machine' | 'wrong-machine-key' | 'wrong-key' | 'not-yet-valid' | 'expired' | 'bad-signature';

export interface StatementExpectation {
    machineId: string;
    // This machine's own key, which a statement v2 has to name.
    machinePublicKey: string;
    // The key that signed the offer the statement arrived in.
    clientPublicKey: string;
    trustedKeys: readonly string[];
    now: number;
}

const signedByTrustedKey = (keys: readonly string[], message: string, signature: string): boolean =>
    keys.some((key) => verifySignature(key, message, signature));

/* Whether a statement opens this machine for this key right now; null when it does, the reason when it does not. */
export const checkStatement = (statement: AccessStatement, expected: StatementExpectation): StatementRefusal | null => {
    if (statement.machineId !== expected.machineId) {
        return 'wrong-machine';
    }
    if (statement.clientPublicKey !== expected.clientPublicKey) {
        return 'wrong-key';
    }
    if (expected.now + STATEMENT_CLOCK_SKEW_MS < statement.issuedAt) {
        return 'not-yet-valid';
    }
    if (expected.now - STATEMENT_CLOCK_SKEW_MS > statement.expiresAt) {
        return 'expired';
    }
    const message = accessStatementMessage(statement.machineId, statement.clientPublicKey, statement.nonce, statement.issuedAt, statement.expiresAt);
    if (!signedByTrustedKey(expected.trustedKeys, message, statement.signature)) {
        return 'bad-signature';
    }
    const { machinePublicKey, accountId, accountSignature } = statement;
    if (machinePublicKey === undefined && accountId === undefined && accountSignature === undefined) {
        return null;
    }
    if (machinePublicKey === undefined || accountId === undefined || accountSignature === undefined) {
        return 'bad-signature';
    }
    // A machine id is no secret, so an account can list it under a key of its own; only the key says the account lists this machine.
    if (machinePublicKey !== expected.machinePublicKey) {
        return 'wrong-machine-key';
    }
    const v2 = accessStatementV2Message(
        statement.machineId,
        machinePublicKey,
        accountId,
        statement.clientPublicKey,
        statement.nonce,
        statement.issuedAt,
        statement.expiresAt
    );
    return signedByTrustedKey(expected.trustedKeys, v2, accountSignature) ? null : 'bad-signature';
};

/* The pinned keys, or the bench's own key in their place when this daemon runs from source and was handed one. */
export const trustedStatementKeys = (env: Record<string, string | undefined>, compiled: boolean): readonly string[] => {
    const testKey = env[TEST_STATEMENT_KEY_VARIABLE]?.trim() ?? '';
    if (compiled || testKey === '' || !isPublicKey(testKey)) {
        return PULSAR_STATEMENT_PUBLIC_KEYS;
    }
    return [testKey];
};

export interface StatementGateOptions {
    machineId: string;
    machinePublicKey: string;
    trustedKeys: readonly string[];
    // Read on every offer, so a switch flipped from a client bites on the next attempt.
    refusesStatements(): boolean;
    // Decides the account as well, against the machine's own account at the moment it lets a key in.
    store: {
        admitStatement(entry: StatementEntry): Promise<StatementAdmission>;
    };
    now?: () => number;
    log?: Pick<Console, 'log' | 'warn'>;
}

export type StatementVerdict = 'admitted' | 'refused' | 'statements-refused';

/*
 * Validate the signed machine, its key, the client key and the lifetime before consulting the opt-out.
 * This prevents invalid callers from learning whether the machine accepts account statements. The
 * nonce and the account are the store's, which decides them as it lets the key in.
 */
export class StatementGate {
    private readonly options: StatementGateOptions;
    private readonly now: () => number;
    private readonly log: Pick<Console, 'log' | 'warn'>;

    constructor(options: StatementGateOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.log = options.log ?? console;
    }

    async admit(from: string, access: SignalAccess): Promise<StatementVerdict> {
        const { statement, label } = access;
        const refusal = checkStatement(statement, {
            machineId: this.options.machineId,
            machinePublicKey: this.options.machinePublicKey,
            clientPublicKey: from,
            trustedKeys: this.options.trustedKeys,
            now: this.now()
        });
        const tag = from.slice(0, 8);
        if (refusal !== null) {
            this.log.warn(`Refused a statement for key ${tag}: ${refusal}`);
            return 'refused';
        }
        if (this.options.refusesStatements()) {
            this.log.warn(`Refused a statement for key ${tag}: this machine takes no statements`);
            return 'statements-refused';
        }
        const accountId = statement.accountId ?? null;
        const result = await this.options.store.admitStatement({
            publicKey: from,
            label,
            nonce: statement.nonce,
            keepNonceUntil: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS,
            accountId
        });
        if ('refused' in result) {
            this.log.warn(`Refused a statement for key ${tag}: ${result.refused}`);
            return 'refused';
        }
        if (accountId === null) {
            this.log.warn(`Took a statement for key ${tag} that names no account; this machine is on none yet, so it still takes one from an older client`);
        }
        if (result.created) {
            this.log.log(`Paired "${label}" (key ${tag}) through a statement from the address book`);
        }
        return 'admitted';
    }
}
