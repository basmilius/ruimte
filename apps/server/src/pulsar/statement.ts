import { PULSAR_STATEMENT_PUBLIC_KEYS, accessStatementMessage, type AccessStatement, type SignalAccess } from '@ruimte/pulsar';
import { isPublicKey, verifySignature } from '../auth/keys.ts';

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

export type StatementRefusal = 'wrong-machine' | 'wrong-key' | 'not-yet-valid' | 'expired' | 'bad-signature';

export interface StatementExpectation {
    machineId: string;
    // The key that signed the offer the statement arrived in.
    clientPublicKey: string;
    trustedKeys: readonly string[];
    now: number;
}

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
    return expected.trustedKeys.some((key) => verifySignature(key, message, statement.signature)) ? null : 'bad-signature';
};

/* The pinned keys, or the bench's own key in their place when this daemon runs from source and was handed one. */
export const trustedStatementKeys = (env: Record<string, string | undefined>, compiled: boolean): readonly string[] => {
    const testKey = env[TEST_STATEMENT_KEY_VARIABLE]?.trim() ?? '';
    if (compiled || testKey === '' || !isPublicKey(testKey)) {
        return PULSAR_STATEMENT_PUBLIC_KEYS;
    }
    return [testKey];
};

export type AdmitStatementResult = { sessionId: string; created: boolean } | { refused: 'replayed' | 'revoked' | 'bad-key' };

export interface StatementGateOptions {
    machineId: string;
    trustedKeys: readonly string[];
    // Read on every offer, so a switch flipped from a client bites on the next attempt.
    refusesStatements(): boolean;
    store: {
        admitStatement(entry: { publicKey: string; label: string; nonce: string; keepNonceUntil: number }): Promise<AdmitStatementResult>;
    };
    now?: () => number;
    log?: Pick<Console, 'log' | 'warn'>;
}

export type StatementVerdict = 'admitted' | 'refused' | 'statements-refused';

/*
 * What a daemon does with a statement in an offer from a key it does not know. The statement has to
 * name this machine and the key that signed the offer, be inside its lifetime and carry a signature
 * from a pinned key; its nonce is then spent for good, and the key lands in the paired clients with
 * the origin `statement`, the same record a pairing link makes. Whether the machine takes statements
 * at all is asked only of a statement that holds up, so a stranger learns nothing about the switch.
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
        const result = await this.options.store.admitStatement({
            publicKey: from,
            label,
            nonce: statement.nonce,
            keepNonceUntil: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS
        });
        if ('refused' in result) {
            this.log.warn(`Refused a statement for key ${tag}: ${result.refused}`);
            return 'refused';
        }
        if (result.created) {
            this.log.log(`Paired "${label}" (key ${tag}) through a statement from the address book`);
        }
        return 'admitted';
    }
}
