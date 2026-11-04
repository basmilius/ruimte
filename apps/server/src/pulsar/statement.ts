import {
    PULSAR_STATEMENT_PUBLIC_KEYS,
    accessStatementMessage,
    accessStatementV2Message,
    peerStatementMessage,
    type AccessStatement,
    type PeerStatement,
    type SignalOfferAccess
} from '@ruimte/pulsar';
import { isPublicKey, verifySignature } from '@ruimte/pulsar/verify-node';
import type { StatementAdmission, StatementEntry } from '../auth/auth-store.ts';

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

type StatementRefusal = 'wrong-machine' | 'wrong-machine-key' | 'wrong-key' | 'not-yet-valid' | 'expired' | 'bad-signature' | 'wrong-peer';

interface StatementExpectation {
    machineId: string;
    // This machine's own key, which a statement v2 has to name.
    machinePublicKey: string;
    // The key that signed the offer the statement arrived in.
    clientPublicKey: string;
    trustedKeys: readonly string[];
    now: number;
}

function signedByTrustedKey(keys: readonly string[], message: string, signature: string): boolean {
    return keys.some((key) => verifySignature(key, message, signature));
}

function lifetimeRefusal(statement: { issuedAt: number; expiresAt: number }, now: number): StatementRefusal | null {
    if (now + STATEMENT_CLOCK_SKEW_MS < statement.issuedAt) {
        return 'not-yet-valid';
    }

    return now - STATEMENT_CLOCK_SKEW_MS > statement.expiresAt ? 'expired' : null;
}

/* Whether a statement opens this machine for this key right now; null when it does, the reason when it does not. */
export function checkStatement(statement: AccessStatement, expected: StatementExpectation): StatementRefusal | null {
    if (statement.machineId !== expected.machineId) {
        return 'wrong-machine';
    }
    if (statement.clientPublicKey !== expected.clientPublicKey) {
        return 'wrong-key';
    }
    const lifetime = lifetimeRefusal(statement, expected.now);
    if (lifetime !== null) {
        return lifetime;
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
}

/*
 * Whether a peer statement lets the machine that offered it work here right now; null when it does. It
 * names this machine and its key, the key that signed the offer, and a different machine for the peer.
 */
export function checkPeerStatement(statement: PeerStatement, expected: StatementExpectation): StatementRefusal | null {
    if (statement.machineId !== expected.machineId) {
        return 'wrong-machine';
    }
    if (statement.machinePublicKey !== expected.machinePublicKey) {
        return 'wrong-machine-key';
    }
    if (statement.peerPublicKey !== expected.clientPublicKey) {
        return 'wrong-key';
    }
    // A machine does not work in itself, and its own keys are never its peer's.
    if (
        statement.peerMachineId === expected.machineId ||
        statement.peerPublicKey === expected.machinePublicKey ||
        statement.peerMachinePublicKey === expected.machinePublicKey
    ) {
        return 'wrong-peer';
    }
    return lifetimeRefusal(statement, expected.now) ?? (peerStatementSigned(statement, expected.trustedKeys) ? null : 'bad-signature');
}

/* Whether the address book signed exactly these fields, for the machine that was asked to work here and the one that works. */
export function peerStatementSigned(statement: PeerStatement, trustedKeys: readonly string[]): boolean {
    const message = peerStatementMessage(
        statement.machineId,
        statement.machinePublicKey,
        statement.accountId,
        statement.peerPublicKey,
        statement.peerMachineId,
        statement.peerMachinePublicKey,
        statement.nonce,
        statement.issuedAt,
        statement.expiresAt
    );
    return signedByTrustedKey(trustedKeys, message, statement.signature);
}

/* The pinned keys, or the bench's own key in their place when this daemon runs from source and was handed one. */
export function trustedStatementKeys(env: Record<string, string | undefined>, compiled: boolean): readonly string[] {
    const testKey = env[TEST_STATEMENT_KEY_VARIABLE]?.trim() ?? '';
    if (compiled || testKey === '' || !isPublicKey(testKey)) {
        return PULSAR_STATEMENT_PUBLIC_KEYS;
    }
    return [testKey];
}

interface StatementGateOptions {
    machineId: string;
    machinePublicKey: string;
    trustedKeys: readonly string[];
    // Decides the account as well, against the machine's own account at the moment it lets a key in.
    store: {
        admitStatement(entry: StatementEntry): Promise<StatementAdmission>;
    };
    now?: () => number;
    log?: Pick<Console, 'log' | 'warn'>;
}

export type StatementVerdict = 'admitted' | 'refused';

/*
 * Checks the signed machine, its key, the client key and the lifetime of a statement. The nonce and
 * the account are the store's, which decides them as it lets the key in.
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

    async admit(from: string, access: SignalOfferAccess): Promise<StatementVerdict> {
        const { label } = access;
        const statement = 'peer' in access ? access.peer : access.statement;
        const expected = {
            machineId: this.options.machineId,
            machinePublicKey: this.options.machinePublicKey,
            clientPublicKey: from,
            trustedKeys: this.options.trustedKeys,
            now: this.now()
        };
        const refusal = 'peer' in access ? checkPeerStatement(access.peer, expected) : checkStatement(access.statement, expected);
        const tag = from.slice(0, 8);
        if (refusal !== null) {
            this.log.warn(`Refused a statement for key ${tag}: ${refusal}`);
            return 'refused';
        }
        const accountId = statement.accountId ?? null;
        const result = await this.options.store.admitStatement({
            publicKey: from,
            label,
            nonce: statement.nonce,
            keepNonceUntil: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS,
            accountId,
            ...('peer' in access ? { peer: { machineId: access.peer.peerMachineId, machinePublicKey: access.peer.peerMachinePublicKey } } : {})
        });
        if ('refused' in result) {
            this.log.warn(`Refused a statement for key ${tag}: ${result.refused}`);
            return 'refused';
        }
        if (result.created) {
            this.log.log(`Let "${label}" (key ${tag}) in through a ${'peer' in access ? 'peer ' : ''}statement from the address book`);
        }
        return 'admitted';
    }
}
