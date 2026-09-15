import type { IceServer } from '@ruimte/pulsar';

/*
 * The servers of one attempt: this client's own STUN setting first, then what the signaling route
 * handed out (TURN credentials from the broker). ICE tries every candidate and prefers a direct pair
 * on its own, so nothing here decides between them; a URL both lists carry is kept once.
 */
export const mergeIceServers = (own: RTCIceServer[], route: IceServer[]): RTCIceServer[] => {
    const seen = new Set<string>();
    const merged: RTCIceServer[] = [];
    for (const server of [...own, ...route]) {
        const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => {
            // A STUN URL answers the same to everyone; a TURN URL with other credentials is another server.
            const id = /^stuns?:/.test(url) ? url : `${url} ${server.username ?? ''}`;
            if (seen.has(id)) {
                return false;
            }
            seen.add(id);
            return true;
        });
        if (urls.length > 0) {
            merged.push({ ...server, urls });
        }
    }
    return merged;
};

interface StatsEntry {
    id?: string;
    type?: string;
    selectedCandidatePairId?: string;
    localCandidateId?: string;
    remoteCandidateId?: string;
    candidateType?: string;
    nominated?: boolean;
    selected?: boolean;
    state?: string;
}

/*
 * Whether the pair ICE is sending on goes through a TURN relay, read from a stats report: the pair
 * the transport names as selected (Chromium, Safari), else one marked selected (Firefox) or nominated
 * and succeeded. Null when the report names no pair yet, which is no answer either way.
 */
export const relayedFromStats = (report: { values(): IterableIterator<unknown> }): boolean | null => {
    const entries = [...report.values()] as StatsEntry[];
    const byId = new Map(entries.filter((entry) => entry.id !== undefined).map((entry) => [entry.id!, entry]));
    const selectedId = entries.find((entry) => entry.type === 'transport' && entry.selectedCandidatePairId !== undefined)?.selectedCandidatePairId;
    const pairs = entries.filter((entry) => entry.type === 'candidate-pair');
    const pair =
        (selectedId !== undefined ? byId.get(selectedId) : undefined) ??
        pairs.find((entry) => entry.selected === true) ??
        pairs.find((entry) => entry.nominated === true && entry.state === 'succeeded');
    if (pair === undefined) {
        return null;
    }
    const local = pair.localCandidateId !== undefined ? byId.get(pair.localCandidateId) : undefined;
    const remote = pair.remoteCandidateId !== undefined ? byId.get(pair.remoteCandidateId) : undefined;
    return local?.candidateType === 'relay' || remote?.candidateType === 'relay';
};
