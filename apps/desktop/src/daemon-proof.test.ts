import { describe, expect, test } from 'bun:test';
import { localProofOf, MACHINE_PROOF_PATH, MachineProofRequestSchema, MACHINE_WORK_PATH } from '@ruimte/contracts';
import { askDaemonWork, proveDaemon, type DaemonPort } from './daemon-proof';

const SECRET = 'the-local-secret';

interface Asked {
    path: string;
    authorization: string | null;
}

/* Whatever holds the port: it answers the proof as `prove` says and the work to anyone who asks. */
const holder = (prove: (nonce: string) => Promise<string | null>) => {
    const asked: Asked[] = [];
    const daemon: DaemonPort = {
        port: 4210,
        readSecret: async () => SECRET,
        nonce: () => 'a-fresh-nonce-for-every-ask',
        fetch: async (url, init) => {
            const path = new URL(url).pathname;
            asked.push({ path, authorization: new Headers(init.headers).get('authorization') });
            if (path === MACHINE_PROOF_PATH) {
                const { nonce } = MachineProofRequestSchema.parse(JSON.parse(String(init.body)));
                const proof = await prove(nonce);
                return proof === null ? new Response('Not found', { status: 404 }) : Response.json({ proof });
            }
            if (path === MACHINE_WORK_PATH) {
                return Response.json({ terminals: 1, agents: 2 });
            }
            return new Response('Not found', { status: 404 });
        }
    };
    return { daemon, asked };
};

describe('proveDaemon', () => {
    test('a daemon that holds the secret proves it', async () => {
        const { daemon } = holder((nonce) => localProofOf(SECRET, 4210, nonce));
        expect(await proveDaemon(daemon)).toBe(true);
    });

    test('something without the route, or with a proof it made up, does not', async () => {
        expect(await proveDaemon(holder(async () => null).daemon)).toBe(false);
        expect(await proveDaemon(holder(async () => 'made-up').daemon)).toBe(false);
        expect(await proveDaemon(holder((nonce) => localProofOf('another-secret', 4210, nonce)).daemon)).toBe(false);
    });

    test('a daemon of the same home on another port cannot answer for this one', async () => {
        expect(await proveDaemon(holder((nonce) => localProofOf(SECRET, 4300, nonce)).daemon)).toBe(false);
    });
});

describe('askDaemonWork', () => {
    test('something that answers health but cannot prove the secret never gets it', async () => {
        const { daemon, asked } = holder(async () => 'made-up');
        expect(await askDaemonWork(daemon)).toBeNull();
        expect(asked.map((entry) => entry.path)).toEqual([MACHINE_PROOF_PATH]);
        expect(asked.every((entry) => entry.authorization === null)).toBe(true);
    });

    test('a daemon that proved the secret is asked with it', async () => {
        const { daemon, asked } = holder((nonce) => localProofOf(SECRET, 4210, nonce));
        expect(await askDaemonWork(daemon)).toEqual({ terminals: 1, agents: 2 });
        expect(asked.at(-1)).toEqual({ path: MACHINE_WORK_PATH, authorization: `Bearer ${SECRET}` });
    });
});
