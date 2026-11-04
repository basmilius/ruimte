import { markPeerLapsed } from '@/project/peer-lapse';
import type { Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;
type PeerLinker = (machineId: string, self: Requester) => Promise<void>;

// Loaded on use; the account code reaches back into the transport the callers are drawn from.
const throughAccount: PeerLinker = async (machineId, self) => (await import('@/pulsar/peer-link')).linkPeerThroughAccount(machineId, self);

let linker = throughAccount;

// One attempt per machine at a time: a second caller (the mirror's renewal, a pill clicked meanwhile) joins it, so one failure costs one round trip to the address book.
const running = new Map<string, Promise<void>>();

// Machines whose link just failed at the place a person made it; the renewal that follows would only ask the address book the same thing again.
const failed = new Set<string>();

/* Lets this machine work in `machineId`, with the account of this window vouching for it. */
export function linkToPeer(machineId: string, self: Requester): Promise<void> {
    const joined = running.get(machineId);
    if (joined !== undefined) {
        return joined;
    }
    const attempt = linker(machineId, self).finally(() => running.delete(machineId));
    running.set(machineId, attempt);
    return attempt;
}

/*
 * The same for a link that is made along the way: a refusal is no error for the caller, it only marks
 * the machine so its nodes offer the way back.
 */
export async function linkToPeerOrMark(machineId: string, self: Requester): Promise<boolean> {
    try {
        await linkToPeer(machineId, self);
        markPeerLapsed(machineId, false);
        failed.delete(machineId);
        return true;
    } catch {
        markPeerLapsed(machineId, true);
        failed.add(machineId);
        return false;
    }
}

/* Whether the last link made along the way failed, said once: the renewal leaves that machine to the pill, which offers the way back. */
export function takeLinkFailure(machineId: string): boolean {
    return failed.delete(machineId);
}

/* For tests: stands in for the account; the returned function puts the real one back. */
export function swapPeerLinker(next: PeerLinker): () => void {
    linker = next;
    return () => {
        linker = throughAccount;
        running.clear();
        failed.clear();
    };
}
