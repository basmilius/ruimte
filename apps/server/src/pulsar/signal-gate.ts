import { signalMessage, type SignalAccess, type SignalEnvelope } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import type { StatementVerdict } from './statement.ts';

// How long a connection id stays tied to the key that offered it; well past the attempt timeout in `DirectPeers`.
const OWNER_TTL_MS = 60_000;

// What became of one signal: passed on, answered with a refusal, or dropped for a signature that does not hold.
export type GateOutcome = 'passed' | 'refused' | 'dropped';

export interface SignalGateOptions {
    /* The daemon's own key from `endpoint.json`, which every signal for this machine is signed to. */
    publicKey: string;
    /* Whether a client key is one this machine already let in. */
    isPaired(publicKey: string): Promise<boolean>;
    /* What an offer from a key the machine does not know gets for the statement it carries (`StatementGate`); without it no statement is taken. */
    admitStatement?(publicKey: string, access: SignalAccess): Promise<StatementVerdict>;
    /* The WebRTC answer code, which takes a signal and a way back and knows nothing of where either goes. */
    receive(envelope: SignalEnvelope, reply: (envelope: SignalEnvelope) => void): void;
    log?: Pick<Console, 'warn'>;
    now?(): number;
}

/*
 * The one check between a signal and `DirectPeers`, whichever way it came: over the broker or through
 * the door on the local network. One gate serves both, so an attempt belongs to the key that offered it
 * on every route at once. What a signal may do past this is decided on the channel by its own handshake.
 */
export class SignalGate {
    private readonly options: SignalGateOptions;
    private readonly owners = new Map<string, { publicKey: string; expiresAt: number }>();

    constructor(options: SignalGateOptions) {
        this.options = options;
    }

    /*
     * An invalid signature is dropped without an answer, so nobody gets this machine to sign a reply of
     * their choosing. A valid offer from a key the machine does not know is answered `not-paired`,
     * unless the statement it carries lets that key in first.
     */
    async accept(from: string, envelope: SignalEnvelope, signature: string, reply: (envelope: SignalEnvelope) => void): Promise<GateOutcome> {
        if (!verifySignature(from, signalMessage(from, this.options.publicKey, envelope), signature)) {
            (this.options.log ?? console).warn('Dropped a signal whose signature does not verify');
            return 'dropped';
        }
        if (!(await this.options.isPaired(from))) {
            const { signal } = envelope;
            if (signal.kind !== 'offer') {
                return 'refused';
            }
            const verdict = signal.access && this.options.admitStatement ? await this.options.admitStatement(from, signal.access) : 'refused';
            if (verdict !== 'admitted') {
                reply({ connectionId: envelope.connectionId, signal: { kind: 'close', reason: 'not-paired' } });
                return 'refused';
            }
        }
        const now = (this.options.now ?? Date.now)();
        for (const [connectionId, owner] of this.owners) {
            if (owner.expiresAt < now) {
                this.owners.delete(connectionId);
            }
        }
        // An attempt belongs to the key that offered it, so another client the machine let in cannot close or feed it.
        const owner = this.owners.get(envelope.connectionId);
        if (owner && owner.publicKey !== from) {
            return 'refused';
        }
        if (!owner && envelope.signal.kind === 'offer') {
            this.owners.set(envelope.connectionId, { publicKey: from, expiresAt: now + OWNER_TTL_MS });
        }
        this.options.receive(envelope, reply);
        return 'passed';
    }
}
