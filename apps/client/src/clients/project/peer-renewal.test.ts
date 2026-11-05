import { beforeEach, describe, expect, test } from 'bun:test';
import type { PeerLink } from '@ruimte/contracts';
import { usePeerLapse } from './peer-lapse';
import { PeerRenewal, RENEW_WITHIN_MS } from './peer-renewal';

const NOW = 1_800_000_000_000;

function link(machineId: string, attestedUntil?: number): PeerLink {
    return {
        machineId,
        label: 'Studio',
        projectId: 'project-1',
        projectName: 'repo',
        ceiling: 'supervised',
        createdAt: 1,
        ...(attestedUntil === undefined ? {} : { attestedUntil })
    };
}

let links: PeerLink[];
let asked: number;
let linked: string[];
let failing: boolean;
let renewal: PeerRenewal;

beforeEach(() => {
    links = [link('machine-a', NOW + 30 * 24 * 60 * 60 * 1000)];
    asked = 0;
    linked = [];
    failing = false;
    usePeerLapse.setState({ lapsed: {} });
    renewal = new PeerRenewal({
        selfId: () => 'machine-a',
        transportOf: () =>
            ({
                request: async () => {
                    asked += 1;
                    return { links };
                }
            }) as never,
        link: async (machineId) => {
            if (failing) {
                throw new Error('Sign in first');
            }
            linked.push(machineId);
        },
        now: () => NOW
    });
});

describe('the right of this machine to work in another one', () => {
    test('is left alone while more than a week of it is left, and asked about once per machine', async () => {
        await renewal.ensure('machine-b');
        await renewal.ensure('machine-b');
        expect(linked).toEqual([]);
        expect(asked).toBe(1);
    });

    test('is renewed silently when a week or less is left, or it ran out, or it never was', async () => {
        for (const until of [NOW + RENEW_WITHIN_MS, NOW - 1, undefined]) {
            links = [link('machine-a', until)];
            const fresh = new PeerRenewal({
                selfId: () => 'machine-a',
                transportOf: () => ({ request: async () => ({ links }) }) as never,
                link: async (id) => void linked.push(id),
                now: () => NOW
            });
            await fresh.ensure('machine-b');
        }
        expect(linked).toEqual(['machine-b', 'machine-b', 'machine-b']);
        expect(usePeerLapse.getState().lapsed).toEqual({});
    });

    test('is not renewed for a machine that links no project for this one', async () => {
        links = [link('machine-z', NOW - 1)];
        await renewal.ensure('machine-b');
        expect(linked).toEqual([]);
    });

    test('is marked as lapsed when it cannot be renewed, asked again next time, and cleared once it can', async () => {
        links = [link('machine-a', NOW - 1)];
        failing = true;
        await renewal.ensure('machine-b');
        expect(usePeerLapse.getState().lapsed).toEqual({ 'machine-b': true });
        failing = false;
        await renewal.ensure('machine-b');
        expect(linked).toEqual(['machine-b']);
        expect(usePeerLapse.getState().lapsed).toEqual({});
    });

    test('waits for a machine this window has no connection to', async () => {
        const away = new PeerRenewal({ selfId: () => 'machine-a', transportOf: () => null, link: async (id) => void linked.push(id) });
        await away.ensure('machine-b');
        expect(linked).toEqual([]);
    });

    test('leaves a machine alone whose link failed at the place a person made it, so one failure costs one attempt', async () => {
        let failedJustNow = true;
        const careful = new PeerRenewal({
            selfId: () => 'machine-a',
            transportOf: () => ({ request: async () => ({ links: [link('machine-a')] }) }) as never,
            link: async (machineId) => void linked.push(machineId),
            now: () => NOW,
            linkFailed: () => {
                const answer = failedJustNow;
                failedJustNow = false;
                return answer;
            }
        });
        await careful.ensure('machine-b');
        await careful.ensure('machine-b');
        expect(linked).toEqual([]);
    });
});
