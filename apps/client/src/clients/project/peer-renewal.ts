import { markPeerLapsed } from '@/clients/project/peer-lapse';
import type { Transport } from '@/transport-api/transport';

// The address book's word on a peer lasts 30 days on the machine worked in; it is renewed while a week of it is left.
export const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

type Requester = Pick<Transport, 'request'>;

interface PeerRenewalHost {
    selfId(): string;
    /* The machine worked in, null while the window has no connection to it. */
    transportOf(machineId: string): Requester | null;
    /* Links this machine to that one anew; rejects when the account cannot vouch for it. */
    link(machineId: string): Promise<void>;
    now?(): number;
    /* Whether a link made just now failed, said once; the machine is then left to the pill that offers the way back. */
    linkFailed?(machineId: string): boolean;
}

/*
 * Keeps this machine's right to work in another one of the account alive while a person uses the link:
 * when a window shows nodes that run there, it asks that machine until when it vouches for this one and
 * links anew, silently, when the time is nearly out or gone. A machine that cannot be renewed (not
 * signed in, the account no longer lists it) is marked, and the pill of its nodes offers the way back.
 */
export class PeerRenewal {
    private readonly host: PeerRenewalHost;
    private readonly checked = new Set<string>();

    constructor(host: PeerRenewalHost) {
        this.host = host;
    }

    /* Once per machine per window, and again after a failure the next time it is asked. */
    async ensure(machineId: string): Promise<void> {
        if (this.checked.has(machineId)) {
            return;
        }
        // A failure costs one attempt: the link that was just made failed for a reason the same ask would meet again.
        if (this.host.linkFailed?.(machineId)) {
            this.checked.add(machineId);
            return;
        }
        const transport = this.host.transportOf(machineId);
        if (transport === null) {
            return;
        }
        this.checked.add(machineId);
        try {
            const { links } = await transport.request('peer.list', {});
            const mine = links.filter((link) => link.machineId === this.host.selfId());
            // A machine that links no project for this one has nothing to renew.
            if (mine.length === 0) {
                return;
            }
            const until = Math.max(...mine.map((link) => link.attestedUntil ?? 0));
            if (until - (this.host.now?.() ?? Date.now()) > RENEW_WITHIN_MS) {
                markPeerLapsed(machineId, false);
                return;
            }
            await this.host.link(machineId);
            markPeerLapsed(machineId, false);
        } catch {
            this.checked.delete(machineId);
            markPeerLapsed(machineId, true);
        }
    }
}
