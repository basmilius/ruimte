import { describe, expect, test } from 'bun:test';
import { mergeIceServers, relayedFromStats } from './ice';

const report = (entries: Array<Record<string, unknown>>) => new Map(entries.map((entry, i) => [String(entry.id ?? `E${i}`), entry]));

describe('mergeIceServers', () => {
    test('keeps the own STUN servers first and adds what the route handed out, a STUN URL only once', () => {
        const turn = { urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'], username: '1:c-x', credential: 'y' };
        expect(mergeIceServers([{ urls: ['stun:turn.ruimte.app:3478'] }], [{ urls: 'stun:turn.ruimte.app:3478' }, turn])).toEqual([
            { urls: ['stun:turn.ruimte.app:3478'] },
            turn
        ]);
        expect(mergeIceServers([], [])).toEqual([]);
        expect(mergeIceServers([{ urls: ['stun:a.example.com'] }], [])).toEqual([{ urls: ['stun:a.example.com'] }]);
    });

    test('keeps the same TURN URL with other credentials, since that is another allocation', () => {
        const merged = mergeIceServers(
            [{ urls: 'turn:turn.example.com:3478', username: 'me', credential: 'a' }],
            [{ urls: 'turn:turn.example.com:3478', username: 'broker', credential: 'b' }]
        );
        expect(merged).toHaveLength(2);
    });
});

describe('relayedFromStats', () => {
    const candidates = [
        { id: 'L-host', type: 'local-candidate', candidateType: 'host' },
        { id: 'L-relay', type: 'local-candidate', candidateType: 'relay' },
        { id: 'R-srflx', type: 'remote-candidate', candidateType: 'srflx' },
        { id: 'R-relay', type: 'remote-candidate', candidateType: 'relay' }
    ];

    test('reads the pair the transport selected, relayed on either end', () => {
        const direct = report([
            { id: 'T', type: 'transport', selectedCandidatePairId: 'P1' },
            { id: 'P1', type: 'candidate-pair', localCandidateId: 'L-host', remoteCandidateId: 'R-srflx', nominated: true, state: 'succeeded' },
            { id: 'P2', type: 'candidate-pair', localCandidateId: 'L-relay', remoteCandidateId: 'R-srflx', nominated: true, state: 'succeeded' },
            ...candidates
        ]);
        expect(relayedFromStats(direct)).toBe(false);

        const remoteRelayed = report([
            { id: 'T', type: 'transport', selectedCandidatePairId: 'P1' },
            { id: 'P1', type: 'candidate-pair', localCandidateId: 'L-host', remoteCandidateId: 'R-relay' },
            ...candidates
        ]);
        expect(relayedFromStats(remoteRelayed)).toBe(true);
    });

    test('falls back to a selected pair or a nominated one that succeeded, and says nothing without a pair', () => {
        expect(
            relayedFromStats(
                report([{ id: 'P', type: 'candidate-pair', selected: true, localCandidateId: 'L-relay', remoteCandidateId: 'R-srflx' }, ...candidates])
            )
        ).toBe(true);
        expect(
            relayedFromStats(
                report([
                    { id: 'P0', type: 'candidate-pair', nominated: true, state: 'in-progress', localCandidateId: 'L-relay', remoteCandidateId: 'R-relay' },
                    { id: 'P1', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L-host', remoteCandidateId: 'R-srflx' },
                    ...candidates
                ])
            )
        ).toBe(false);
        expect(relayedFromStats(report([{ id: 'T', type: 'transport', bytesReceived: 10 }, ...candidates]))).toBeNull();
    });
});
