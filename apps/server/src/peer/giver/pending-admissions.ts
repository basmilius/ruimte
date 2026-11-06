import type { PeerStatement } from '@ruimte/pulsar';

/*
 * The statements the address book signed for this machine to work in another, until the other machine
 * has let this one in. It is in memory on purpose: a statement lives ten minutes, and once the other
 * machine admitted the peer key it needs no statement any more.
 */
export class PendingAdmissions {
    private readonly statements = new Map<string, PeerStatement>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    /* A newer statement replaces an older one for the same machine. */
    hold(statement: PeerStatement): void {
        this.statements.set(statement.machineId, statement);
    }

    /* The statement for a machine, or null when none was handed over or it ran out. */
    peek(machineId: string): PeerStatement | null {
        const statement = this.statements.get(machineId);
        if (statement === undefined) {
            return null;
        }
        if (statement.expiresAt < this.now()) {
            this.statements.delete(machineId);
            return null;
        }
        return statement;
    }

    clear(): void {
        this.statements.clear();
    }

    /* With `statement`, only while that one is still the one held, so a newer statement handed over meanwhile stays. */
    release(machineId: string, statement?: PeerStatement): void {
        if (statement === undefined || this.statements.get(machineId) === statement) {
            this.statements.delete(machineId);
        }
    }
}
