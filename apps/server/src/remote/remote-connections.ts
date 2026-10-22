import type { RemoteStatusEvent } from '@ruimte/contracts';
import type { PeerStatement } from '@ruimte/pulsar';
import { CodedError } from '@adecore/agents';
import { PEER_ATTEMPT_TIMEOUT_MS, openBrokerLine, openPeerLink, type PeerLink, type PeerSigner } from './peer-connection.ts';
import type { PeerMachine, PeerMachines } from './peer-machines.ts';
import type { PendingAdmissions } from './pending-admissions.ts';
import type { RemoteStatus } from './remote-status.ts';

export class RemoteLinkError extends CodedError<'unknown-machine' | 'no-broker' | 'unreachable' | 'refused' | 'closed'> {}

/*
 * What the other machine says when it will not have this one: it does not know the key (never let in, run
 * out or revoked) or refuses the statement. Trying again changes neither. Another protocol is no refusal:
 * an update of either machine ends it, so the reconnect keeps trying.
 */
export function refusedByMachine(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    return /closed the attempt: (not-paired|statements-refused)|does not know this device/.test(message);
}

/* Why the other machine would not have this one, in words for the line of a task that fails on it. */
export function refusalWords(message: string): string {
    if (message.includes('not-paired') || message.includes('does not know this device')) {
        return 'it does not know this machine, or no longer vouches for it';
    }
    if (message.includes('statements-refused')) {
        return 'it takes no statement from this machine';
    }
    return message.slice(0, 200);
}

/* Opens a link to one machine; rejects with the reason it could not. */
export interface PeerDialer {
    dial(machine: PeerMachine, statement: PeerStatement | null): Promise<PeerLink>;
}

export interface BrokerDialerOptions {
    signer: PeerSigner;
    /* The broker this machine uses itself, for a machine whose own broker is not known. */
    defaultBroker(): string | null;
    /* What the other machine calls this one. */
    label(): string;
    timeoutMs?: number;
}

/* The production dialer: the broker for the signals, then a direct channel for everything else. */
export function brokerDialer(options: BrokerDialerOptions): PeerDialer {
    return {
        async dial(machine, statement) {
            const url = machine.brokerUrl ?? options.defaultBroker();
            if (url === null || url === undefined) {
                throw new RemoteLinkError('no-broker', 'These machines cannot reach each other through your account');
            }
            const timeoutMs = options.timeoutMs ?? PEER_ATTEMPT_TIMEOUT_MS;
            const line = await openBrokerLine({ url, signer: options.signer, machinePublicKey: machine.publicKey, timeoutMs });
            try {
                return await openPeerLink({ line, signer: options.signer, machine, label: options.label(), statement, timeoutMs });
            } catch (e) {
                line.close();
                throw e;
            }
        }
    };
}

export interface RemoteConnectionsOptions {
    machines: Pick<PeerMachines, 'get'>;
    pending: Pick<PendingAdmissions, 'peek' | 'release'>;
    dialer: PeerDialer;
    status: RemoteStatus;
    /* How many pieces of work wait on the link to that machine. */
    owed(machineId: string): number;
    /* The nodes whose task that machine has not been asked to start yet; `except` is an entry that is done and about to go. */
    unstarted(machineId: string, except?: string): string[];
}

/*
 * The links this machine holds to machines it works in, one at most per machine. A link that fails or
 * is lost says so to the clients only while work waits on it: a link nothing is owed for just closes,
 * and the reconnect (`connect-peer.ts`) is what keeps trying while something is.
 */
export class RemoteConnections {
    private readonly options: RemoteConnectionsOptions;
    private readonly links = new Map<string, PeerLink>();
    private readonly attempts = new Map<string, Promise<PeerLink>>();
    // Raised by every close, so an attempt that was running then keeps nothing it opens after.
    private readonly generations = new Map<string, number>();
    private readonly lostListeners = new Set<(machineId: string) => void>();
    private readonly frameListeners = new Set<(machineId: string, raw: string) => void>();

    constructor(options: RemoteConnectionsOptions) {
        this.options = options;
    }

    isOpen(machineId: string): boolean {
        return this.links.has(machineId);
    }

    knows(machineId: string): boolean {
        return this.options.machines.get(machineId) !== null;
    }

    /* The open link to a machine, or null while there is none. */
    link(machineId: string): PeerLink | null {
        return this.links.get(machineId) ?? null;
    }

    /* Told when an open link goes, so whatever owes work to that machine can ask for a reconnect. */
    onLost(listener: (machineId: string) => void): void {
        this.lostListeners.add(listener);
    }

    /* Told of every frame a machine sends that is no reply to a request, such as word that a task of it settled. */
    onFrame(listener: (machineId: string, raw: string) => void): void {
        this.frameListeners.add(listener);
    }

    /* Resolves once the link is open, at once when it already is; one attempt serves everyone who asks while it runs. */
    async connect(machineId: string): Promise<PeerLink> {
        const open = this.links.get(machineId);
        if (open !== undefined) {
            return open;
        }
        const running = this.attempts.get(machineId);
        if (running !== undefined) {
            return running;
        }
        const attempt = this.dial(machineId).finally(() => {
            if (this.attempts.get(machineId) === attempt) {
                this.attempts.delete(machineId);
            }
        });
        this.attempts.set(machineId, attempt);
        return attempt;
    }

    /*
     * Opens the link with the statement a person's window just handed over, so the machine vouches for this
     * one anew. A link that was open already, or was being made without that statement, stays as it is:
     * the statement goes over a link of its own, which closes once the machine took it.
     */
    async connectWithStatement(machineId: string): Promise<void> {
        await this.connect(machineId);
        const statement = this.options.pending.peek(machineId);
        const machine = this.options.machines.get(machineId);
        if (statement === null || machine === null) {
            return;
        }
        const renewal = await this.options.dialer.dial(machine, statement);
        renewal.close();
        this.options.pending.release(machineId, statement);
    }

    /* Closes the link on purpose, such as when the machine is unlinked; nobody is told it was lost, and an attempt still running keeps nothing. */
    close(machineId: string): void {
        this.generations.set(machineId, this.generationOf(machineId) + 1);
        this.attempts.delete(machineId);
        this.links.get(machineId)?.close();
        this.links.delete(machineId);
        this.options.status.forget(machineId);
    }

    closeAll(): void {
        for (const machineId of new Set([...this.links.keys(), ...this.attempts.keys()])) {
            this.close(machineId);
        }
    }

    private generationOf(machineId: string): number {
        return this.generations.get(machineId) ?? 0;
    }

    /* The standing of a machine whose link is closed, as the clients see it. */
    idle(machineId: string): void {
        this.publish(machineId, this.links.has(machineId) ? 'open' : null);
    }

    /* A reconnect is due at `nextAttemptAt`. */
    waiting(machineId: string, nextAttemptAt: number): void {
        this.options.status.set({ ...this.standing(machineId, 'waiting'), nextAttemptAt });
    }

    /*
     * Says again how many tasks wait. `except` is an entry that is done. Work owed with no standing told of, as
     * after a restart, gets one, so a client never takes a missing standing for a task the machine was not asked.
     */
    refresh(machineId: string, except?: string): void {
        const held = this.options.status.get(machineId);
        if (held === null || held.state === 'closed') {
            if (this.knows(machineId) && this.options.owed(machineId) > 0) {
                this.options.status.set(this.standing(machineId, this.links.has(machineId) ? 'open' : 'waiting', except));
            }
            return;
        }
        this.options.status.set(this.standing(machineId, held.state, except, held.nextAttemptAt));
    }

    private standing(machineId: string, state: 'open' | 'connecting' | 'waiting', except?: string, nextAttemptAt?: number): RemoteStatusEvent {
        const brokerUrl = this.options.machines.get(machineId)?.brokerUrl;
        const unstarted = this.options.unstarted(machineId, except);
        return {
            machineId,
            state,
            owed: this.options.owed(machineId),
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            ...(brokerUrl ? { brokerUrl } : {}),
            ...(unstarted.length === 0 ? {} : { unstartedNodeIds: unstarted })
        };
    }

    private async dial(machineId: string): Promise<PeerLink> {
        const machine = this.options.machines.get(machineId);
        if (machine === null) {
            throw new RemoteLinkError('unknown-machine', 'This machine was never linked to that one');
        }
        const generation = this.generationOf(machineId);
        this.publish(machineId, 'connecting');
        const statement = this.options.pending.peek(machineId);
        let link: PeerLink;
        try {
            link = await this.options.dialer.dial(machine, statement);
        } catch (e) {
            if (this.generationOf(machineId) !== generation) {
                throw new RemoteLinkError('closed', 'The link was closed while it was being made');
            }
            const refused = refusedByMachine(e);
            this.publish(machineId, this.options.owed(machineId) > 0 && !refused ? 'waiting' : null);
            throw refused ? new RemoteLinkError('refused', e instanceof Error ? e.message : 'That machine refused this one') : e;
        }
        // Closed meanwhile (unlinked, or this machine left its account): a handshake that finished late is not kept.
        if (this.generationOf(machineId) !== generation || !this.knows(machineId)) {
            link.close();
            throw new RemoteLinkError('closed', 'The link was closed while it was being made');
        }
        // The machine let this key in, so the statement has done what it was for.
        if (statement !== null) {
            this.options.pending.release(machineId, statement);
        }
        this.links.set(machineId, link);
        link.onLost(() => this.lost(machineId, link));
        link.onFrame((raw) => {
            for (const listener of this.frameListeners) {
                listener(machineId, raw);
            }
        });
        this.publish(machineId, 'open');
        return link;
    }

    private lost(machineId: string, link: PeerLink): void {
        if (this.links.get(machineId) !== link) {
            return;
        }
        this.links.delete(machineId);
        link.close();
        this.publish(machineId, this.options.owed(machineId) > 0 ? 'waiting' : null);
        for (const listener of this.lostListeners) {
            listener(machineId);
        }
    }

    private publish(machineId: string, state: 'open' | 'connecting' | 'waiting' | null): void {
        if (state === null) {
            this.options.status.forget(machineId);
            return;
        }
        this.options.status.set(this.standing(machineId, state));
    }
}
